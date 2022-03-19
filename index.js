'use strict';

const AWS = require('aws-sdk');
const chalk = require('chalk');

class AppClientCredentialsExporter {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    // parse the plugin configuration
    this.pluginConfig = this.serverless.service.custom['serverless-app-client-credentials-to-ssm'];
    if (!this.pluginConfig
      || !this.pluginConfig.userPoolId
      || !this.pluginConfig.appClientName
      || !this.pluginConfig.parameterName) {
      this.log('error', 'missing required plugin configuration, please check the documentation');
      return;
    }

    // set up aws resource clients
    this.provider = this.serverless.getProvider('aws');
    this.region = this.provider.getRegion();
    AWS.config.update({
      region: this.region
    });

    this.cognitoIdp = new AWS.CognitoIdentityServiceProvider();
    this.ssm = new AWS.SSM();

    // set up serverless hooks
    this.hooks = {
      // 'initialize': this.exportCredetialsToSSM.bind(this),
      'after:deploy:deploy': this.exportCredetialsToSSM.bind(this),
    };
  }

  async exportCredetialsToSSM() {
    const that = this;
    that.log('info', `plugin configuration: ${JSON.stringify(this.pluginConfig)}`);

    // 1. list all app clients in the user pool
    that.log('info', `getting app client ${that.pluginConfig.appClientName} in user pool ${that.pluginConfig.userPoolId}`);
    const appClients = await that.listAllCognitoAppClients();
    if (!appClients) {
      that.log('error', `serverless-app-client-credentials-to-ssm: no app clients found in user pool ${that.pluginConfig.userPoolId}`);
      return;
    }

    // 2. filter the app clients by name
    const appClient = appClients.find(c => c.ClientName.toUpperCase() === that.pluginConfig.appClientName.toUpperCase());
    if (!appClient) {
      that.log('error', `no app client found with name ${that.pluginConfig.appClientName} in user pool ${that.pluginConfig.userPoolId}`);
      return;
    }

    // 3. describe user pool to get authentication url
    this.cognitoIdp.describeUserPool({ UserPoolId: that.pluginConfig.userPoolId}, function(err, data) {
      if (err) {
        that.log('error', `failed to describe user pool due to ${JSON.stringify(err)}`);
      } else {
        const authUrl = `https://${data.UserPool.Domain}.auth.${that.region}.amazoncognito.com/oauth2/token`;

        // 4. describe user pool client to get credentials
        that.log('info', `pulling app client credentials for ${that.pluginConfig.appClientName}`);
        const describeUserPoolClientParams = {
          UserPoolId: appClient.UserPoolId,
          ClientId: appClient.ClientId,
        };
        that.cognitoIdp.describeUserPoolClient(describeUserPoolClientParams, function(err, data) {
          if (err) {
            that.log('error', `failed to describe user pool client due to ${JSON.stringify(err)}`);
          } else  {
            // 5. put parameter to SSM with app client configurations
            that.log('info', `updating parameter ${that.pluginConfig.parameterName} with app client credentials`);
            const appClientConfig = {
              auth: {
                cognito: {
                  url: authUrl,
                  clientId: describeUserPoolClientParams.ClientId,
                  clientSecret: data.UserPoolClient.ClientSecret,
                },
              },
            };
            const putParameterParams = {
              Name: that.pluginConfig.parameterName,
              Value: JSON.stringify(appClientConfig, null, '\t'),
              DataType: 'text',
              Overwrite: true,
              Tier: 'Standard',
              Type: 'String',
            };
            that.ssm.putParameter(putParameterParams, function(err, data) {
              if (err) {
                that.log('error', `failed to put parameter ${JSON.stringify(putParameterParams)} due to ${JSON.stringify(err)}`);
              }
              that.log('info', `app client credentials have been exported to parameter ${that.pluginConfig.parameterName}`);
            });
          }
        });
      }
    });
  }

  async listAllCognitoAppClients() {
    var that = this;
    var appClients = [];
    var params = {
      UserPoolId: that.pluginConfig.userPoolId,
      /* NextToken: 'STRING_VALUE' */
    };
    var hasNext = true;
    while(hasNext) {
      await this.cognitoIdp.listUserPoolClients(params).promise().then(data => {
        if(data.UserPoolClients.length != 0) {
          appClients.push.apply(appClients, data.UserPoolClients);
          if(data.NextToken) {
            params.NextToken = data.NextToken;
          } else {
            hasNext = false;
          }
        } else {
          hasNext = false;
        }
      }).catch(err => {
        that.log('error', `failed to list user pool clients due to ${JSON.stringify(err)}`);
        hasNext = false;
      });
    }
    if(appClients.length==0) {
      return null;
    } else {
      return appClients;
    }
  }

  log(level, message) {
    if (level == 'error') {
        console.log(chalk.red(`ERROR: [serverless-app-client-credentials-to-ssm] ${message}`));
    } else if (level == 'warn') {
        console.log(chalk.yellow(`WARNING: [serverless-app-client-credentials-to-ssm] ${message}`));
    } else if (level == 'info') {
        if (this.options.v) console.log(chalk.green('[serverless-app-client-credentials-to-ssm] ') + message);
    } else {
        if (process.env.SLS_DEBUG) console.log(chalk.blue('[serverless-app-client-credentials-to-ssm] ') + message);
    }
  }
}

module.exports = AppClientCredentialsExporter;
