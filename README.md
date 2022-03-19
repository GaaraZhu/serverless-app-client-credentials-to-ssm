# serverless-app-client-credentials-to-ssm
Export Cognito app client credentials to SSM Parameter store

# Background
[Amazon Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html) is a powerful service for application authentication, authorization, and user management . When working with µservice applications, we can use AWS Cognito user pool authentication for a fine-grained service-to-service access control where each service has a dedicated resoruce server with pre-defined scopes for its resources(API Gateway, Lambda etc), and a dedicated app client with limited scopes it needs to access external resources.<br/><br/>
The service-to-service communication starts with a user pool sign-in with the app client credentials and a JWT token will be returned to access target service resource. We used to copy the app client credentials manually from AWS console and paste to the service configuration. With the increasing number of µservices, we need a tool to do this securely and automatically for us.

# How it works
A serverless hook will be triggered after the deployment to pull the app client credentials from Cognito and push to SSM parameter store.

# Installation
First, add Serverless-app-client-credentials-to-ssm to your project:
`npm install serverless-app-client-credentials-to-ssm --save-dev`

# Configuration
## plugin registration
Inside your project's serverless.yml file add following entry to the plugins section:
```YAML
plugins:
  - serverless-app-client-credentials-to-ssm
```
## plugin configuration
Then you need to add the plugin configuration to the custom section:
```YAML
custom:
  serverless-app-client-credentials-to-ssm:
    userPoolId: ${ssm:/layered-apis/userPoolId}
    appClientName: ${self:custom.appClientName}
    parameterName: /layered-apis/${self:service}/${self:provider.stage}
```

# License
MIT

# Contributing
Yes, highly appreciate for any PRs. Thank you!
