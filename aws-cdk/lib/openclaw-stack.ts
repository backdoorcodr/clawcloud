import { Stack, StackProps, CfnOutput, Duration, aws_ec2 as ec2, aws_ecs as ecs, aws_efs as efs, aws_elasticloadbalancingv2 as elb, aws_secretsmanager as secretsmanager, aws_cognito as cognito, aws_dynamodb as dynamodb, aws_iam as iam, aws_ecr as ecr, aws_logs as logs } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface OpenclawStackProps extends StackProps {
  ecrImageUri: string;
  domainName?: string;
}

/**
 * OpenclawStack creates the complete multi-tenant OpenClaw hosting infrastructure:
 * - Foundation: VPC, ECS, EFS, ALB, Cognito, DynamoDB, IAM
 * - Portal: Next.js provisioning app on Fargate
 * 
 * This single stack avoids cyclic dependencies between the portal service and the ALB it registers with.
 */
export class OpenclawStack extends Stack {
  public readonly vpc: ec2.IVpc;
  public readonly cluster: ecs.ICluster;
  public readonly efsFileSystem: efs.FileSystem;
  public readonly alb: elb.ApplicationLoadBalancer;
  public readonly listener: elb.ApplicationListener;
  public readonly gatewaySecret: secretsmanager.ISecret;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly instancesTable: dynamodb.Table;
  public readonly portalRole: iam.Role;
  public readonly portalUrl: string;

  constructor(scope: Construct, id: string, props: OpenclawStackProps) {
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

    // Security group for EFS
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
          "elasticfilesystem:TagResource",
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
          "ec2:DescribeNetworkInterfaces",
        ],
        resources: ["*"],
      })
    );

    // Grant portal DynamoDB table access
    instancesTable.grantReadWriteData(portalRole);

    this.portalRole = portalRole;

    // Import existing ECR repositories
    const portalRepo = ecr.Repository.fromRepositoryName(this, "PortalRepo", "openclaw/portal");
    const gatewayRepo = ecr.Repository.fromRepositoryName(this, "GatewayRepo", "openclaw/gateway");

    // Security group for gateway tasks
    const gatewaySg = new ec2.SecurityGroup(this, "GatewaySecurityGroup", {
      vpc,
      description: "Security group for OpenClaw gateway tasks",
      allowAllOutbound: true,
    });
    gatewaySg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(18789), 'Gateway HTTP access');

    // Gateway task definition (template for on-demand user tasks)
    const gatewayTaskDef = new ecs.FargateTaskDefinition(this, "GatewayTaskDefinition", {
      memoryLimitMiB: 4096,
      cpu: 2048,
    });

    const gatewayContainer = gatewayTaskDef.addContainer("Container", {
      image: ecs.ContainerImage.fromEcrRepository(gatewayRepo, "latest"),
      logging: new ecs.AwsLogDriver({
        streamPrefix: "openclaw-gateway",
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        HOME: "/home/node",
        TERM: "xterm-256color",
      },
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:18789/health || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(90),
      },
    });

    gatewayContainer.addPortMappings({
      containerPort: 18789,
      protocol: ecs.Protocol.TCP,
    });

    // IAM policy for gateway tasks to access EFS
    gatewayTaskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
        ],
        resources: [efsFs.fileSystemArn],
      })
    );

    // Security group for portal tasks
    const portalSg = new ec2.SecurityGroup(this, "PortalSecurityGroup", {
      vpc,
      description: "Security group for OpenClaw portal tasks",
      allowAllOutbound: true,
    });

    // Portal task definition
    const portalTaskDef = new ecs.FargateTaskDefinition(this, "PortalTaskDef", {
      memoryLimitMiB: 1024,
      cpu: 512,
      taskRole: portalRole,
    });

    // Portal container with all environment variables
    const portalContainer = portalTaskDef.addContainer("PortalContainer", {
      image: ecs.ContainerImage.fromEcrRepository(portalRepo, "latest"),
      logging: new ecs.AwsLogDriver({
        streamPrefix: "openclaw-portal",
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "3000",
        NEXT_PUBLIC_USER_POOL_ID: userPool.userPoolId,
        NEXT_PUBLIC_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        NEXT_PUBLIC_REGION: this.region,
        AWS_REGION: this.region,
        DYNAMODB_TABLE_NAME: instancesTable.tableName,
        ECS_CLUSTER_ARN: cluster.clusterArn,
        EFS_FILE_SYSTEM_ID: efsFs.fileSystemId,
        ALB_DNS_NAME: alb.loadBalancerDnsName,
        VPC_ID: vpc.vpcId,
        PRIVATE_SUBNET_IDS: vpc.privateSubnets.map(s => s.subnetId).join(','),
        PUBLIC_SUBNET_IDS: vpc.publicSubnets.map(s => s.subnetId).join(','),
        GATEWAY_TASK_DEFINITION_ARN: gatewayTaskDef.taskDefinitionArn,
        GATEWAY_SECURITY_GROUP_ID: gatewaySg.securityGroupId,
        BRAVE_API_KEY: process.env.BRAVE_API_KEY ?? '',
      },
    });

    portalContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    // Portal target group
    const portalTargetGroup = new elb.ApplicationTargetGroup(this, "PortalTargetGroup", {
      vpc,
      port: 3000,
      protocol: elb.ApplicationProtocol.HTTP,
      targetType: elb.TargetType.IP,
      healthCheck: {
        path: "/api/health",
        port: "3000",
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
      },
    });

    // Portal Fargate service
    const portalService = new ecs.FargateService(this, "PortalService", {
      cluster,
      taskDefinition: portalTaskDef,
      securityGroups: [portalSg],
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    portalService.attachToApplicationTargetGroup(portalTargetGroup);

    // HTTP listener with portal as default target
    const listener = alb.addListener("HttpListener", {
      port: 80,
      protocol: elb.ApplicationProtocol.HTTP,
      defaultAction: elb.ListenerAction.forward([portalTargetGroup]),
    });
    this.listener = listener;

    this.portalUrl = `http://${alb.loadBalancerDnsName}`;

    // Outputs
    new CfnOutput(this, "VPCId", { value: vpc.vpcId });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "EFSId", { value: efsFs.fileSystemId });
    new CfnOutput(this, "ALBDNSName", { value: alb.loadBalancerDnsName });
    new CfnOutput(this, "PortalURL", { value: this.portalUrl });
    new CfnOutput(this, "PortalECRRepo", { value: portalRepo.repositoryUri });
    new CfnOutput(this, "ECRImageUri", { value: props.ecrImageUri });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "InstancesTableName", { value: instancesTable.tableName });
  }
}
