// /**
//  * Send File to Remote Server Tool (1:1 mapping - broker transport)
//  *
//  * Direct mapping to file-management-ability's sendFileToRemoteServer() method.
//  * Uploads files to remote servers via SSH/SCP.
//  * Uses broker transport: ability registers with centralized KADI broker.
//  */
//
// import {z, logger, MODULE_AGENT, timer} from './utils.js';
// import type {KadiClient} from '@kadi.build/core';
//
// // Broker transport - ability connects to centralized broker server
//
// export const sendFileToRemoteServerInputSchema = z.object({
//     username: z.string().describe('SSH username for authentication'),
//     host: z.string().describe('Remote host address (e.g., "server.example.com" or "192.168.1.100")'),
//     localFilePath: z.string().describe('Local file path to upload (absolute or relative)'),
//     remoteFilePath: z.string().describe('Remote destination path where file will be uploaded'),
//     privateKey: z.string().optional().describe('Optional: Path to SSH private key file (e.g., "~/.ssh/id_rsa")')
// });
//
// export const sendFileToRemoteServerOutputSchema = z.object({
//     success: z.boolean().describe('Whether the upload succeeded'),
//     message: z.string().describe('Success message or error details')
// });
//
// export type SendFileToRemoteServerInput = z.infer<typeof sendFileToRemoteServerInputSchema>;
// export type SendFileToRemoteServerOutput = z.infer<typeof sendFileToRemoteServerOutputSchema>;
//
// /**
//  * Register the send_file_to_remote_server tool
//  *
//  * This tool provides direct 1:1 mapping to file-management-ability's
//  * sendFileToRemoteServer() method without any proxy layers.
//  */
// export function registerSendFileToRemoteServerTool(client: KadiClient) {
//     client.registerTool(
//         {
//             name: 'send_file_to_remote_server',
//             description: 'Upload a file to a remote server via SSH/SCP. Direct mapping to file-management-ability. Supports SSH private key authentication.',
//             input: sendFileToRemoteServerInputSchema,
//             output: sendFileToRemoteServerOutputSchema,
//         },
//         async (params: SendFileToRemoteServerInput): Promise<SendFileToRemoteServerOutput> => {
//             logger.info(
//                 MODULE_AGENT,
//                 `Executing send_file_to_remote_server: ${params.localFilePath} -> ${params.username}@${params.host}:${params.remoteFilePath}`,
//                 timer.elapsed('main')
//             );
//
//             try {
//                 // Load ability via broker transport (connects to centralized broker)
//                 // The broker URL is typically ws://localhost:8080/kadi (configured in agent setup)
//                 // The ability must be pre-registered with the broker before this call
//
//                 logger.info(MODULE_AGENT, `Loading ability via broker transport...`, timer.elapsed('main'));
//
//                 const fileManager = await client.load('file-management-ability', 'broker');
//
//                 // Call through broker transport (WebSocket/broker communication)
//                 const result = await fileManager.send_file_to_remote_server(params);
//
//                 // Disconnect after use
//                 await fileManager.__disconnect();
//
//                 logger.info(MODULE_AGENT, `Upload completed: ${result.message}`, timer.elapsed('main'));
//
//                 return result;
//
//             } catch (error: unknown) {
//                 const errorMessage = error instanceof Error ? error.message : String(error);
//
//                 logger.info(
//                     MODULE_AGENT,
//                     `Upload failed: ${errorMessage}`,
//                     timer.elapsed('main')
//                 );
//
//                 return {
//                     success: false,
//                     message: `Upload failed: ${errorMessage}`
//                 };
//             }
//         }
//     );
// }
