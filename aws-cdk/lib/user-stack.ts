import { Stack, StackProps, CfnOutput, aws_ec2 as ec2, aws_ecs as ecs, aws_iam as iam } from "aws-cdk-lib";
import { Construct } from "constructs";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import { FileSystem } from "aws-cdk-lib/aws-efs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";

export interface UserStackProps extends StackProps {
  vpc: IVpc;
  efsFileSystem: FileSystem;
  ecrImageUri: string;
}

/**
 * UserStack creates a template task definition for OpenClaw gateway instances.
 * The portal will use this task definition to launch on-demand tasks via ECS RunTask API.
 * No services are created here - tasks are launched dynamically by the portal.
 */
export class UserStack extends Stack {
  public readonly gatewayTaskDefinition: FargateTaskDefinition;
  public readonly gatewaySecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: UserStackProps) {
    super(scope, id, props);

    const { vpc, efsFileSystem, ecrImageUri } = props;

    // Security group for gateway tasks (will be used by portal when launching tasks)
    const taskSg = new ec2.SecurityGroup(this, 'GatewaySecurityGroup', {
      vpc,
      description: 'Security group for OpenClaw gateway tasks',
      allowAllOutbound: true,
    });

    // Allow inbound on port 18789 for gateway access
    taskSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(18789), 'Gateway HTTP access');

    // Task definition (template for on-demand tasks)
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'GatewayTaskDefinition', {
      memoryLimitMiB: 4096,
      cpu: 2048,
    });

    // Container definition
    const container = taskDefinition.addContainer('GatewayContainer', {
      image: ecs.ContainerImage.fromRegistry(ecrImageUri),
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'openclaw-gateway',
      }),
      environment: {
        HOME: '/home/node',
        TERM: 'xterm-256color',
      },
    });

    container.addPortMappings({
      containerPort: 18789,
      protocol: ecs.Protocol.TCP,
    });

    // Note: EFS volume and environment variables will be added at runtime
    // by the portal when launching tasks via ECS RunTask API with overrides

    // IAM policy for EFS access
    taskDefinition.taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:ClientRootAccess',
        ],
        resources: [efsFileSystem.fileSystemArn],
      })
    );

    // Export for portal stack
    this.gatewayTaskDefinition = taskDefinition;
    this.gatewaySecurityGroup = taskSg;

    // Outputs
    new CfnOutput(this, 'GatewayTaskDefinitionArn', {
      value: taskDefinition.taskDefinitionArn,
      description: 'ARN of the gateway task definition template',
    });

    new CfnOutput(this, 'GatewaySecurityGroupId', {
      value: taskSg.securityGroupId,
      description: 'Security group ID for gateway tasks',
    });
  }
}
