export function sshConnectCommand(ssh: { username: string; host: string; port: number }): string {
  return `ssh -p ${ssh.port} ${ssh.username}@${ssh.host}`;
}
