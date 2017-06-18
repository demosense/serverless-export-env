"use strict";

const BbPromise = require("bluebird")
	, _ = require("lodash");

/**
 * Resolves CloudFormation references and import variables
 *
 * @param {Serverless} serverless - Serverless Instance
 * @param {Object[]} envVars - Environment Variables
 * @returns {Promise<String[]>} Resolves with the list of environment variables
 */
function resolveCloudFormationenvVars(serverless, envVars) {

	const AWS = serverless.providers.aws;
	return BbPromise.join(
		AWS.request("CloudFormation", "describeStackResources", { StackName: AWS.naming.getStackName() }),
		AWS.request("CloudFormation", "listExports")
	)
	.spread((resultStackResources, resultExports) => {
		const resources = resultStackResources.StackResources;
		const exports = resultExports.Exports;

		function mapValue(value, key) {
			let resolved = value;
			if (_.isObject(value)) {
				if (value.Ref) {
					if (value.Ref === "AWS::Region") {
						resolved = AWS.getRegion();
					}
					else if (value.Ref === "AWS::AccountId") {
						resolved = AWS.getAccountId();
					}
					else if (value.Ref === "AWS::StackId") {
						resolved = _.get(_.first(resources), "StackId");
					}
					else if (value.Ref === "AWS::StackName") {
						resolved = AWS.naming.getStackName();
					}
					else {
						const resource = _.find(resources, [ "LogicalResourceId", value.Ref ]);
						resolved = _.get(resource, "PhysicalResourceId", null);
						if (_.isNil(resolved)) {
							serverless.cli.log(`WARNING: Failed to resolve reference ${value.Ref}`);
						}
					}
				}
				else if (value["Fn::ImportValue"]) {
					const importKey = value["Fn::ImportValue"];
					const resource = _.find(exports, [ "Name", importKey ]);
					resolved = _.get(resource, "Value", null);
					if (_.isNil(resolved)) {
						serverless.cli.log(`WARNING: Failed to resolve import value ${importKey}`);
					}
				}
				else if (value["Fn::Join"]) {
					resolved = "";
					// Join has two Arguments. first the delimiter and second the values
					let delimiter = value["Fn::Join"][0];
					let parts = value["Fn::Join"][1];
					_.forEach(parts, (v, i) => {
						resolved += mapValue(v) + (i < parts.length - 1 ? delimiter : "");
					});
				}

				process.env.SLS_DEBUG && key && serverless.cli.log(`Resolved environment variable ${key}: ${JSON.stringify(resolved)}`);
			}

			return resolved;
		}
		return _.mapValues(envVars, (value, key) => mapValue(value, key));
	});
}

module.exports = resolveCloudFormationenvVars;
