import { Stack, StackProps, CfnOutput, Duration, aws_ec2 as ec2, aws_ecs as ecs, aws_elasticloadbalancingv2 as elb, aws_ecr as ecr, aws_logs as logs } from "aws-cdk-lib";
import { Construct } from "constructs";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { ICluster, FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import { FileSystem } from "aws-cdk-lib/aws-efs";
import { ApplicationListener } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Role } from "aws-cdk-lib/aws-iam";

export interface PortalStackProps extends StackProps {
  vpc: IVpc;
  cluster: ICluster;
  efsFileSystem: FileSystem;
  listener: ApplicationListener;
  albDnsName: string;
  userPool: UserPool;
  userPoolClient: UserPoolClient;
  instancesTable: Table;
  portalRole: Role;
  gatewayTaskDefinition: FargateTaskDefinition;
  gatewaySecurityGroup: ec2.ISecurityGroup;
}

export class PortalStack extends Stack {
  public readonly portalUrl: string;

  constructor(scope: Construct, id: string, props: PortalStackProps) {
    super(scope, id, props);

    const {
      vpc,
      cluster,
      listener,
      albDnsName,
      userPool,
      userPoolClient,
      instancesTable,
      portalRole,
      gatewayTaskDefinition,
      gatewaySecurityGroup,
      efsFileSystem,
    } = props;

    // ECR repository for the portal image
    const portalRepo = new ecr.Repository(this, "PortalRepo", {
      repositoryName: "openclaw/portal",
    });

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

    // Portal container
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
        GATEWAY_TASK_DEFINITION_ARN: gatewayTaskDefinition.taskDefinitionArn,
        EFS_FILE_SYSTEM_ID: efsFileSystem.fileSystemId,
        ALB_DNS_NAME: albDnsName,
        VPC_ID: vpc.vpcId,
        GATEWAY_SECURITY_GROUP_ID: gatewaySecurityGroup.securityGroupId,
        // Subnet IDs will be passed as comma-separated list
        PRIVATE_SUBNET_IDS: vpc.privateSubnets.map(s => s.subnetId).join(','),
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

    // ALB listener: portal gets all traffic (catch-all default action)
    listener.addTargetGroups("PortalDefault", {
      targetGroups: [portalTargetGroup],
    });

    this.portalUrl = `http://${albDnsName}`;

    // Outputs
    new CfnOutput(this, "PortalURL", { value: this.portalUrl });
    new CfnOutput(this, "PortalECRRepo", { value: portalRepo.repositoryUri });
  }
}
