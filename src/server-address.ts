let current: { port: number; host: string } | null = null
export function setLocalServerAddress(port: number, host: string): void { current = { port, host } }
export function getLocalServerAddress(): { port: number; host: string } | null { return current }
