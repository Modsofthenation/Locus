import type { WindowsUnattendConfig } from "@locus/shared";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function psSingle(value: string): string {
  return value.replace(/'/g, "''");
}

export function renderUnattend(config: WindowsUnattendConfig, sshPublicKey?: string): string {
  const user = xmlEscape(config.username);
  const pass = xmlEscape(config.password);
  const host = xmlEscape(config.hostname);
  const locale = xmlEscape(config.locale || "en-US");
  const commands = firstLogonCommands(config, sshPublicKey);
  const firstLogon = commands.length
    ? `
      <FirstLogonCommands>
${commands
  .map(
    (cmd, i) => `        <SynchronousCommand wcm:action="add">
          <Order>${i + 1}</Order>
          <CommandLine>${xmlEscape(cmd)}</CommandLine>
        </SynchronousCommand>`,
  )
  .join("\n")}
      </FirstLogonCommands>`
    : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend"
          xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE"
               processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS">
      <SetupUILanguage><UILanguage>${locale}</UILanguage></SetupUILanguage>
      <InputLocale>${locale}</InputLocale>
      <SystemLocale>${locale}</SystemLocale>
      <UILanguage>${locale}</UILanguage>
      <UserLocale>${locale}</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup"
               processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS">
      <UserData>
        <AcceptEula>true</AcceptEula>
      </UserData>
      <DiskConfiguration>
        <WillShowUI>OnError</WillShowUI>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add">
              <Order>1</Order>
              <Type>EFI</Type>
              <Size>100</Size>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>2</Order>
              <Type>MSR</Type>
              <Size>16</Size>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>3</Order>
              <Type>Primary</Type>
              <Extend>true</Extend>
            </CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order>
              <PartitionID>1</PartitionID>
              <Format>FAT32</Format>
              <Label>System</Label>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>2</Order>
              <PartitionID>2</PartitionID>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>3</Order>
              <PartitionID>3</PartitionID>
              <Format>NTFS</Format>
              <Label>Windows</Label>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
      <ImageInstall>
        <OSImage>
          <InstallTo>
            <DiskID>0</DiskID>
            <PartitionID>3</PartitionID>
          </InstallTo>
        </OSImage>
      </ImageInstall>
    </component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS">
      <ComputerName>${host}</ComputerName>
      <AutoLogon>
        <Enabled>${config.autologon ? "true" : "false"}</Enabled>
        <Username>${user}</Username>
        <Password><Value>${pass}</Value><PlainText>true</PlainText></Password>
        <LogonCount>3</LogonCount>
      </AutoLogon>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>${user}</Name>
            <Group>Administrators</Group>
            <Password><Value>${pass}</Value><PlainText>true</PlainText></Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>${config.skipOobe ? "true" : "false"}</SkipMachineOOBE>
        <SkipUserOOBE>${config.skipOobe ? "true" : "false"}</SkipUserOOBE>
      </OOBE>
      ${firstLogon}
    </component>
  </settings>
</unattend>
`;
}

function psCommand(script: string): string {
  return `powershell.exe -NoProfile -Command "${script.replace(/"/g, '\\"')}"`;
}

function firstLogonCommands(config: WindowsUnattendConfig, sshPublicKey?: string): string[] {
  const cmds: string[] = [];
  const workspace = `C:\\Users\\${config.username}\\workspace`;
  if (config.enableRdp) {
    cmds.push(
      'cmd.exe /c netsh advfirewall firewall set rule group="remote desktop" new enable=Yes',
    );
    cmds.push(
      'cmd.exe /c reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f',
    );
  }
  if (config.enableWinRm) {
    cmds.push(
      psCommand(
        "Enable-PSRemoting -Force; Set-Item -Path WSMan:\\localhost\\Service\\Auth\\Basic -Value $true; Set-Item -Path WSMan:\\localhost\\Service\\AllowUnencrypted -Value $true",
      ),
    );
    cmds.push(
      psCommand(
        "New-NetFirewallRule -DisplayName 'WinRM HTTP' -Direction Inbound -Protocol TCP -LocalPort 5985 -Action Allow -ErrorAction SilentlyContinue",
      ),
    );
  }
  cmds.push(
    psCommand(
      "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction SilentlyContinue; Start-Service sshd -ErrorAction SilentlyContinue; Set-Service -Name sshd -StartupType Automatic -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force -Path $env:ProgramData\\ssh | Out-Null",
    ),
  );
  if (sshPublicKey) {
    cmds.push(
      psCommand(
        `Set-Content -Encoding ascii -Path $env:ProgramData\\ssh\\administrators_authorized_keys -Value '${psSingle(sshPublicKey)}'; icacls $env:ProgramData\\ssh\\administrators_authorized_keys /inheritance:r /grant SYSTEM:F /grant BUILTIN\\Administrators:F`,
      ),
    );
  }
  cmds.push(
    psCommand(
      "New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue",
    ),
  );
  cmds.push(
    psCommand(
      `New-Item -ItemType Directory -Force -Path '${psSingle(workspace)}' | Out-Null; New-Item -ItemType Directory -Force -Path 'C:\\host' | Out-Null; winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Null`,
    ),
  );
  cmds.push(
    psCommand(
      "winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Null",
    ),
  );
  return cmds;
}

export async function writeUnattendDir(
  dir: string,
  config: WindowsUnattendConfig,
  sshPublicKey?: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "Autounattend.xml"), renderUnattend(config, sshPublicKey), {
    encoding: "utf8",
    mode: 0o600,
  });
  return dir;
}
