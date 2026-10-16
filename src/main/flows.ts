import type { Flow, FlowRun } from '../shared/types'

// STUB — replaced by the flow runner.
export const flowsApi = {
  async list(_projectId: string): Promise<Flow[]> {
    return []
  },
  async save(_projectId: string, flow: Flow): Promise<Flow> {
    return flow
  },
  async remove(_projectId: string, _id: string): Promise<void> {},
  async runs(_projectId: string): Promise<FlowRun[]> {
    return []
  },
  async run(_projectId: string, _flowId: string): Promise<FlowRun> {
    throw new Error('Flow runner not implemented yet')
  },
  async decide(_runId: string, _approve: boolean): Promise<void> {},
  async stop(_runId: string): Promise<void> {}
}
export function stopAllFlows(): void {}
