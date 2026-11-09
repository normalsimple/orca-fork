// fork: every RPC method the fork adds to a host. rpc-method-registry.ts spreads FORK_RPC_METHODS into
// ALL_RPC_METHODS; their schemas live in src/fork, so rpc-params-type-parity.ts skips ForkRpcMethodName.
import { HOST_FILE_METHODS, type HostFileMethodName } from './host-file-methods'
import {
  FORK_WORKSPACE_EXEC_METHODS,
  type ForkWorkspaceExecMethodName
} from './workspace-exec-method'

export const FORK_RPC_METHODS = [...HOST_FILE_METHODS, ...FORK_WORKSPACE_EXEC_METHODS]

export type ForkRpcMethodName = HostFileMethodName | ForkWorkspaceExecMethodName
