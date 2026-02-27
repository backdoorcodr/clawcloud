#!/usr/bin/env node
import "source-map-support/register";
import { App, Stack, StackProps, CfnOutput, Duration, aws_ec2 as ec2, aws_ecs as ecs, aws_efs as efs, aws_elasticloadbalancingv2 as elb, aws_iam as iam, aws_ecr as ecr } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";

const app = new App();

const env = {
  region: process.env.CDK_DEFAULT_REGION || "eu-west-1",
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

const ecrImageUri = process.env.ECR_IMAGE_URI || "010928201123.dkr.ecr.eu-west-1.amazonaws.com/openclaw/gateway:latest";
const userId = "alice";
const gatewayToken = process.env.ALICE_TOKEN || "alice-test-token";
const idleTimeoutSeconds = 60;

// Single stack for the demo
class OpenclawStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC with 2 AZs
    const vpc = new ec2.Vpc(this, "OpenclawVPC", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "Private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "OpenclawCluster", { vpc, clusterName: "openclaw-hosted" });

    // ECR Repository - use fromRepositoryName to get the existing repo
    const ecrRepo = ecr.Repository.fromRepositoryName(this, "ECRRepo", "openclaw/gateway");

    // EFS
    const efsFs = new efs.FileSystem(this, "OpenclawEFS", {
      vpc,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
    });

    // EFS Access Point
    const accessPoint = efsFs.addAccessPoint(`UserAccessPoint`, {
      path: `/users/${userId}`,
      createAcl: { ownerGid: "1000", ownerUid: "1000", permissions: "755" },
      posixUser: { gid: "1000", uid: "1000" },
    });

    // Security group for tasks - allow inbound from ALB
    const taskSg = new ec2.SecurityGroup(this, "TaskSecurityGroup", { vpc, allowAllOutbound: true });
    taskSg.connections.allowFrom(new ec2.Connections({ peer: ec2.Peer.ipv4(vpc.vpcCidrBlock) }), ec2.Port.tcp(18789));

    // FIX: Allow task containers to reach EFS mount targets on NFS port 2049
    efsFs.connections.allowDefaultPortFrom(taskSg);

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 4096,
      cpu: 2048,
    });

    // FIX: Add AdministratorAccess to execution role (temporary, for debugging)
    taskDefinition.executionRole?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess")
    );

    // Container - use fromEcrRepository for proper IAM permissions
    // Override CMD to bind on all interfaces (required for ALB health checks)
    // This is the documented approach in the Dockerfile comment
    const containerDefinition = new ecs.ContainerDefinition(this, "Container", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "latest"),
      essential: true,
      taskDefinition,
      logging: new ecs.AwsLogDriver({ streamPrefix: "openclaw" }),
      command: ["node", "openclaw.mjs", "gateway", "--allow-unconfigured", "--bind", "lan"],
    });

    containerDefinition.addPortMappings({ containerPort: 18789, protocol: ecs.Protocol.TCP });
    containerDefinition.addEnvironment("HOME", "/home/node");
    containerDefinition.addEnvironment("TERM", "xterm-256color");
    containerDefinition.addEnvironment("OPENCLAW_GATEWAY_TOKEN", gatewayToken);
    containerDefinition.addEnvironment("OPENCLAW_GATEWAY_IDLE_TIMEOUT_SECONDS", idleTimeoutSeconds.toString());
    containerDefinition.addEnvironment("OPENCLAW_GATEWAY_CONTROL_UI_BASE_PATH", `/u/${userId}`);
    containerDefinition.addMountPoints({ containerPath: "/home/node/.openclaw", sourceVolume: "userData", readOnly: false });

    // EFS Volume
    taskDefinition.addVolume({
      name: "userData",
      efsVolumeConfiguration: {
        fileSystemId: efsFs.fileSystemId,
        transitEncryption: "ENABLED",
        authorizationConfig: { accessPointId: accessPoint.accessPointId, iam: "ENABLED" },
      },
    });

    // IAM for EFS
    taskDefinition.taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite", "elasticfilesystem:ClientRootAccess"],
        resources: [efsFs.fileSystemArn],
      })
    );

    // ALB
    const alb = new elb.ApplicationLoadBalancer(this, "OpenclawALB", { vpc, internetFacing: true, loadBalancerName: "openclaw-hosted" });
    const listener = alb.addListener("HttpListener", { port: 80, protocol: elb.ApplicationProtocol.HTTP });

    // Default action - return 404 for unmatched paths
    listener.addAction("DefaultAction", {
      action: elb.ListenerAction.fixedResponse(404, { messageBody: "Not Found - use /u/<user-id>" }),
    });

    // Target Group - must use IP type for Fargate
    const targetGroup = new elb.ApplicationTargetGroup(this, "TargetGroup", {
      vpc,
      port: 18789,
      protocol: elb.ApplicationProtocol.HTTP,
      targetType: elb.TargetType.IP,
      healthCheck: { path: "/health", port: "18789", healthyThresholdCount: 2, unhealthyThresholdCount:5, interval: Duration.seconds(30), timeout: Duration.seconds(10) },
    });

    // Fargate Service - with public IP for direct access
    const fargateService = new ecs.FargateService(this, "FargateService", {
      cluster,
      taskDefinition,
      securityGroups: [taskSg],
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    fargateService.attachToApplicationTargetGroup(targetGroup);

    // Listener Rule
    listener.addAction("UserRule", {
      priority: 100,
      conditions: [elb.ListenerCondition.pathPatterns(["/u/*"])],
      action: elb.ListenerAction.forward([targetGroup]),
    });

    // Outputs
    new CfnOutput(this, "ALBDNSName", { value: alb.loadBalancerDnsName });
    new CfnOutput(this, "UserURL", { value: `http://${alb.loadBalancerDnsName}/u/${userId}` });
  }
}

new OpenclawStack(app, "OpenclawStack", { env });

app.synth();
