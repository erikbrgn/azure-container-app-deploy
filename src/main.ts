import * as core from '@actions/core'
import { ContainerAppsAPIClient } from '@azure/arm-appcontainers'
import { ResourceManagementClient } from '@azure/arm-resources'
import { DefaultAzureCredential } from '@azure/identity'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const appName = core.getInput('app-name')
    const containerName = core.getInput('container-name')
    const resourceGroupName = core.getInput('resource-group-name')
    const image = core.getInput('image')

    core.debug(`Provided image through input: ${image}`)

    core.debug('Attempting to retrieve Azure credentials...')

    const credential = new DefaultAzureCredential()

    const subscriptionId =
      process.env.AZURE_SUBSCRIPTION_ID || core.getInput('subscription-id')

    if (!subscriptionId) {
      throw new Error('AZURE_SUBSCRIPTION_ID is not set. aborting...')
    }

    const resourcesClient = new ResourceManagementClient(
      credential,
      subscriptionId
    )

    const containerAppClient = new ContainerAppsAPIClient(
      credential,
      subscriptionId
    )

    resourcesClient.resourceGroups
      .checkExistence(resourceGroupName)
      .then((result) => {
        if (!result) {
          throw new Error(
            `Resource group ${resourceGroupName} does not exist. Aborting...`
          )
        }
      })

    resourcesClient.resources
      .checkExistence(
        resourceGroupName,
        'Microsoft.App',
        '',
        'containerApps',
        appName,
        '2025-01-01'
      )
      .then((result) => {
        if (!result.body) {
          throw new Error(`App ${appName} does not exist. Aborting...`)
        }
      })

    const existingContainerAppEnvelope =
      await containerAppClient.containerApps.get(resourceGroupName, appName)

    const result = await containerAppClient.containerApps.beginUpdate(
      resourceGroupName,
      appName,
      {
        location: existingContainerAppEnvelope.location,
        template: {
          containers: [
            {
              name: containerName,
              image: image
            }
          ]
        }
      }
    )

    // log the status of the update every few seconds...
    core.debug(
      `Container app ${appName} is being updated. Status: ${result.getOperationState().status}`
    )

    const poller = await result.pollUntilDone()

    if (!poller) {
      throw new Error(`Failed to update container app ${appName}. Aborting...`)
    }

    core.debug(`Container app ${appName} updated successfully.`)

    core.setOutput('status: ', result.getOperationState().status)
    core.setOutput('container-app: ', JSON.stringify(result))
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
