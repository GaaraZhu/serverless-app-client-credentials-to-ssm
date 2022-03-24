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
      'after:deploy:deploy': this.exportCredetialsToSSM.bind(this),
    };
  }

  async exportCredetialsToSSM() {
    const that = this;
    that.log('info', `plugin configuration: ${JSON.stringify(this.pluginConfig)}`);

    // 1. find app client in the user pool
    that.log('info', `getting app client ${that.pluginConfig.appClientName} in user pool ${that.pluginConfig.userPoolId}`);
    const appClient = await that.findAppClient();
    if (!appClient) {
      that.log('error', `no app client found with name ${that.pluginConfig.appClientName} in user pool ${that.pluginConfig.userPoolId}`);
      return;
    }

    // 2. describe user pool to get authentication url
    this.cognitoIdp.describeUserPool({ UserPoolId: that.pluginConfig.userPoolId}, function(err, data) {
      if (err) {
        that.log('error', `failed to describe user pool due to ${err}`);
      } else {
        const authUrl = `https://${data.UserPool.Domain}.auth.${that.region}.amazoncognito.com/oauth2/token`;

        // 3. pull existing application configuration from parameter store
        const getParameterParams = {
          Name: that.pluginConfig.parameterName,
        };
        var applicationConfig = {};
        that.ssm.getParameter(getParameterParams, function(err, data) {
          if (err && err.code !== 'ParameterNotFound') {
              that.log('error', `failed to get parameter ${that.pluginConfig.parameterName} due to ${err}`);
          }
          if (data && data.Parameter.Value) {
            applicationConfig = JSON.parse(data.Parameter.Value);
          }

          // 4. describe user pool client to get credentials
          that.log('info', `pulling app client credentials for ${that.pluginConfig.appClientName}`);
          const describeUserPoolClientParams = {
            UserPoolId: appClient.UserPoolId,
            ClientId: appClient.ClientId,
          };
          that.cognitoIdp.describeUserPoolClient(describeUserPoolClientParams, function(err, data) {
            if (err) {
              that.log('error', `failed to describe user pool client due to ${err}`);
            } else  {
              // 5. put parameter to SSM with app client configurations
              that.log('info', `updating parameter ${that.pluginConfig.parameterName} with app client credentials`);

              const appClientConfig = {
                url: authUrl,
                clientId: describeUserPoolClientParams.ClientId,
                clientSecret: data.UserPoolClient.ClientSecret,
              };
              if (applicationConfig.auth && applicationConfig.auth.cognito) {
                const currentAppClientConfig = applicationConfig.auth.cognito;
                if (currentAppClientConfig.url === appClientConfig.url
                  && currentAppClientConfig.clientId === appClientConfig.clientId
                  && currentAppClientConfig.clientSecret === appClientConfig.clientSecret) {
                    that.log('warn', `finished exporting app client credentials as no changes have been detected`);
                    return;
                  }
              }
              that.log('info', `merging app client configuration and application configuration`);
              applicationConfig = that.mergeApplicationConfig(applicationConfig, appClientConfig);
              const putParameterParams = {
                Name: that.pluginConfig.parameterName,
                Value: JSON.stringify(applicationConfig, null, '\t'),
                DataType: 'text',
                Overwrite: true,
                Tier: 'Standard',
                Type: 'String',
              };
              that.ssm.putParameter(putParameterParams, function(err, data) {
                if (err) {
                  that.log('error', `failed to put parameter ${JSON.stringify(putParameterParams)} due to ${err}`);
                } else {
                  that.log('info', `app client credentials have been exported to parameter ${that.pluginConfig.parameterName}`);
                }
              });
            }
          });
        });
      }
    });
  }

  /**
   * List app clients in batches to find the app client
   * @returns an app client if exists, null if not
   */
  async findAppClient() {
    var that = this;
    var resultAppClient = null;
    var params = {
      UserPoolId: that.pluginConfig.userPoolId,
      /* NextToken: 'STRING_VALUE' */
    };
    var hasNext = true;
    while(hasNext) {
      await this.cognitoIdp.listUserPoolClients(params).promise().then(data => {
        if(data.UserPoolClients.length != 0) {
          resultAppClient = data.UserPoolClients.find(c => c.ClientName.toUpperCase() === that.pluginConfig.appClientName.toUpperCase());
          if (resultAppClient) {
            hasNext = false;
            return;
          }

          if(data.NextToken) {
            params.NextToken = data.NextToken;
            return;
          }
        }
        hasNext = false;
      }).catch(err => {
        that.log('error', `failed to list user pool clients due to ${err}`);
        hasNext = false;
      });
    }
    return resultAppClient;
  }

  /**
   * Updating app client credentials in application configuration
   * @param {*} appConfig application configuration
   * @param {*} appClientConfig app client configuration, including authentication URL, client id, and client credentials
   * @returns merged application configuration like below
   * {
   *  auth: {
   *    cognito: {
   *      url: "https://asdfafdsa-systems-idp-nonprod.auth.ap-southeast-2.amazoncognito.com/oauth2/token",
   *      clientId: "asdfadsf",
   *      clientSecret: "s1oglveco0hsfraoag90ebr107rmvo9g7u36h"
   *    }
   *  },
   *  ....
   * }
   */
  mergeApplicationConfig(appConfig, appClientConfig) {
    if (appConfig.auth) {
      appConfig.auth['cognito'] = appClientConfig;
    } else {
      appConfig.auth = {
        cognito: appClientConfig,
      };
    }

    return appConfig;
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
