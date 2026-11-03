// fork: every RPC method the fork adds to a host. rpc/methods/index.ts spreads FORK_RPC_METHODS into
// ALL_RPC_METHODS; their schemas live in src/fork, so rpc-params-type-parity.ts skips ForkRpcMethodName.
import { HOST_FILE_METHODS, type HostFileMethodName } from './host-file-methods'

export const FORK_RPC_METHODS = [...HOST_FILE_METHODS]

export type ForkRpcMethodName = HostFileMethodName
