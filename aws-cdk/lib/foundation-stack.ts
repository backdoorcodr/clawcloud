import { Stack, StackProps, CfnOutput, Duration, aws_ec2 as ec2, aws_ecs as ecs, aws_efs as efs, aws_elasticloadbalancingv2 as elb, aws_secretsmanager as secretsmanager, aws_cognito as cognito, aws_dynamodb as dynamodb, aws_iam as iam } from "aws-cdk-lib";
import { Construct } from "constructs";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { ICluster } from "aws-cdk-lib/aws-ecs";
import { FileSystem } from "aws-cdk-lib/aws-efs";
import { ApplicationLoadBalancer, ApplicationListener } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Role } from "aws-cdk-lib/aws-iam";

export interface FoundationStackProps extends StackProps {
  ecrImageUri: string;
  domainName?: string;
}

export class FoundationStack extends Stack {
  public readonly vpc: IVpc;
  public readonly cluster: ICluster;
  public readonly efsFileSystem: FileSystem;
  public readonly alb: ApplicationLoadBalancer;
  public readonly listener: ApplicationListener;
  public readonly gatewaySecret: ISecret;
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly instancesTable: Table;
  public readonly portalRole: Role;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    // VPC with 2 AZs
    const vpc = new ec2.Vpc(this, "OpenclawVPC", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });
    this.vpc = vpc;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "OpenclawCluster", {
      vpc,
      clusterName: "openclaw-hosted",
    });
    this.cluster = cluster;

    // EFS for persistent user storage
    const efsFs = new efs.FileSystem(this, "OpenclawEFS", {
      vpc,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
    });
    this.efsFileSystem = efsFs;

    // Security group for EFS (only allow from ECS tasks)
    const efsSg = new ec2.SecurityGroup(this, "EFSSecurityGroup", {
      vpc,
      allowAllOutbound: false,
    });
    efsSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(2049));

    // Secrets Manager for gateway tokens
    const secret = new secretsmanager.Secret(this, "GatewayTokenSecret", {
      secretName: "openclaw/gateway-tokens",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ default: "change-me-in-prod" }),
        generateStringKey: "token",
      },
    });
    this.gatewaySecret = secret;

    // ALB with 3600s idle timeout (fixes WebSocket 1006 disconnects)
    const alb = new elb.ApplicationLoadBalancer(this, "OpenclawALB", {
      vpc,
      internetFacing: true,
      loadBalancerName: "openclaw-hosted",
      idleTimeout: Duration.seconds(3600),
    });
    this.alb = alb;

    // HTTP listener (PortalStack will add routing rules)
    const listener = alb.addListener("HttpListener", {
      port: 80,
      protocol: elb.ApplicationProtocol.HTTP,
      defaultAction: elb.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Not Found',
      }),
    });
    this.listener = listener;

    // Cognito User Pool for authentication
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "openclaw-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });
    this.userPool = userPool;

    // Cognito User Pool Client for the portal app
    const userPoolClient = userPool.addClient("PortalClient", {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
    });
    this.userPoolClient = userPoolClient;

    // DynamoDB table for tracking user instances
    const instancesTable = new dynamodb.Table(this, "InstancesTable", {
      tableName: "openclaw-instances",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    this.instancesTable = instancesTable;

    // IAM role for the portal to manage user instances
    const portalRole = new iam.Role(this, "PortalRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Role for OpenClaw portal to launch and manage user instances",
    });

    // Grant portal permissions to run ECS tasks
    portalRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ecs:RunTask",
          "ecs:DescribeTasks",
          "ecs:StopTask",
        ],
        resources: ["*"],
      })
    );

    // Grant portal permissions to pass IAM roles to ECS tasks
    portalRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "ecs-tasks.amazonaws.com",
          },
        },
      })
    );

    // Grant portal permissions to manage user secrets
    portalRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:GetSecretValue",
          "secretsmanager:DeleteSecret",
        ],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:openclaw/users/*`],
      })
    );

    // Grant portal permissions to create EFS access points
    portalRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "elasticfilesystem:CreateAccessPoint",
          "elasticfilesystem:DescribeAccessPoints",
          "elasticfilesystem:DeleteAccessPoint",
        ],
        resources: [efsFs.fileSystemArn],
      })
    );

    // Grant portal permissions to describe VPC resources
    portalRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
        ],
        resources: ["*"],
      })
    );

    // Grant portal DynamoDB table access
    instancesTable.grantReadWriteData(portalRole);

    this.portalRole = portalRole;

    // Outputs
    new CfnOutput(this, "VPCId", { value: vpc.vpcId });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "EFSId", { value: efsFs.fileSystemId });
    new CfnOutput(this, "ALBDNSName", { value: alb.loadBalancerDnsName });
    new CfnOutput(this, "ECRImageUri", { value: props.ecrImageUri });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "InstancesTableName", { value: instancesTable.tableName });
  }
}
