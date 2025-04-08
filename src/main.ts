import * as core from '@actions/core'
import { exec, type ExecListeners } from '@actions/exec'
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
    // Start by retrieving the subscription ID by running az account show
    // and parsing the output. This is a workaround for the fact that
    // the subscription ID can't be retrieved from the azure/login action directly.
    const subscriptionId =
      (await getSubscriptionId()) || core.getInput('subscription-id')

    if (!subscriptionId) {
      throw new Error('No subscription ID found. aborting...')
    }

    const appName = core.getInput('app-name')
    const containerName = core.getInput('container-name')
    const resourceGroupName = core.getInput('resource-group-name')
    const image = core.getInput('image')

    core.debug(`Provided image through input: ${image}`)

    core.debug('Attempting to generate Azure credentials...')

    const credential = new DefaultAzureCredential()

    if (!credential) {
      throw new Error('Failed to generate Azure credentials. Aborting...')
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

async function getSubscriptionId(): Promise<string> {
  let output = ''

  // Capture the output from the command
  const options: { listeners: ExecListeners } = {
    listeners: {
      stdout: (data) => {
        output += data.toString()
      }
    }
  }

  // Execute the Azure CLI command
  await exec('az account show --query id -o tsv', [], options)

  // Clean the output
  const subscriptionId = output.trim()

  return subscriptionId
}
