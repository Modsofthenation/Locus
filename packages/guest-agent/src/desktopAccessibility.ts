import type { ToolRequest } from "./types.js";

/** Execute in the interactive guest session, never on the control-plane host. */
export function linuxAccessibilityCommand(req: ToolRequest): string {
  const payload = Buffer.from(
    JSON.stringify({ ...req.args, snapshot: req.name === "a11y_tree" }),
  ).toString("base64");
  return `timeout --kill-after=1s 10s python3 -c '${LINUX_ACCESSIBILITY.replace(/'/g, `'\\''`)}' '${payload}'`;
}

export const LINUX_ACCESSIBILITY = `import base64,json,sys
try:
 import pyatspi
 args=json.loads(base64.b64decode(sys.argv[1]))
 root=pyatspi.Registry.getDesktop(0)
 def resolve(path):
  node=root
  for i in path: node=node[i]
  return node
 if args.get("snapshot"):
  nodes=[]
  def walk(node,path,depth):
   if len(nodes)>=200 or depth>8: return
   try:
    name=node.name or ""
    state=node.getState()
    bounds=None
    try:
     rect=node.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
     bounds=[rect.x,rect.y,rect.width,rect.height]
    except Exception: pass
    nodes.append(dict(ref=str(node.get_process_id())+":"+".".join(map(str,path))+":"+str(node.path),name=name,role=node.getRoleName(),bounds=bounds,depth=depth,enabled=state.contains(pyatspi.STATE_ENABLED),checked=state.contains(pyatspi.STATE_CHECKED),selected=state.contains(pyatspi.STATE_SELECTED),editable=state.contains(pyatspi.STATE_EDITABLE)))
    for i in range(min(node.childCount,200)): walk(node[i],path+[i],depth+1)
   except Exception: pass
  def scan(node,path,depth):
   if not args.get("title") or args["title"].lower() in (node.name or "").lower(): walk(node,path,0)
   elif depth<3:
    for i in range(min(node.childCount,200)): scan(node[i],path+[i],depth+1)
  for i in range(root.childCount): scan(root[i],[i],0)
  print(json.dumps(dict(backend="at-spi",nodes=nodes,truncated=len(nodes)>=200)))
 else:
  pid,path,identity=args["ref"].split(":",2)
  node=resolve([int(i) for i in path.split(".")])
  if str(node.get_process_id())!=pid or str(node.path)!=identity or node.name!=args["name"]: raise RuntimeError("Stale accessibility ref; call a11y_tree again")
  if not node.getState().contains(pyatspi.STATE_ENABLED): raise RuntimeError("Control is disabled")
  action=args["action"]
  verified=False
  if action=="fill":
   if not node.getState().contains(pyatspi.STATE_EDITABLE): raise RuntimeError("Control is not editable")
   text=str(args.get("value",""))
   node.queryEditableText().setTextContents(text)
   verified=node.queryText().getText(0,-1)==text
  elif action=="select":
   selection=node.parent.querySelection()
   selection.selectChild(node.getIndexInParent())
   verified=selection.isChildSelected(node.getIndexInParent())
  elif action in ("invoke","check"):
   desired=args.get("checked",True)
   if action=="check" and node.getRole() not in (pyatspi.ROLE_CHECK_BOX,pyatspi.ROLE_TOGGLE_BUTTON): raise RuntimeError("Expected a checkbox or toggle")
   if action=="invoke" or node.getState().contains(pyatspi.STATE_CHECKED)!=desired:
    interface=node.queryAction()
    choices=[i for i in range(interface.nActions) if interface.getName(i).lower() in ("click","press","activate","toggle")]
    if not choices: raise RuntimeError("No semantic action available; inspect screenshot")
    if not interface.doAction(choices[0]): raise RuntimeError("Accessibility action failed")
   verified=action=="invoke" or node.getState().contains(pyatspi.STATE_CHECKED)==desired
  else: raise RuntimeError("Unsupported desktop action")
  if not verified: raise RuntimeError("Control did not reach the requested state; observe again")
  print(json.dumps(dict(ok=True,action=action,verified=action!="invoke",note="Invocation dispatched; verify application outcome" if action=="invoke" else "Control state verified")))
except Exception as error:
 print(json.dumps(dict(ok=False,error=str(error),recovery="Check computer_capabilities and refresh a11y_tree; use human takeover if accessibility is unavailable")))
 sys.exit(1)
`;

export function windowsAccessibilityCommand(req: ToolRequest): string {
  const payload = Buffer.from(
    JSON.stringify({ ...req.args, snapshot: req.name === "uia_tree" }),
    "utf8",
  ).toString("base64");
  return `$ErrorActionPreference='Stop'; $a = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; ${WINDOWS_ACCESSIBILITY}`;
}

export const WINDOWS_ACCESSIBILITY = `
try {
 Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
 $root=[Windows.Automation.AutomationElement]::RootElement
 $script:n=0; $script:found=$null; $script:nodes=[Collections.Generic.List[object]]::new()
 function Walk($el,$depth) {
  if ($null -eq $el -or $script:n -ge 1000 -or $depth -gt 12) { return }
  $script:n++
  try {
   $c=$el.Current; $ref=($el.GetRuntimeId() -join '.')
   if ($a.snapshot -and $script:nodes.Count -lt 200) {
    $script:nodes.Add(@{ref=$ref;name=$c.Name;role=$c.ControlType.ProgrammaticName;enabled=$c.IsEnabled;depth=$depth;bounds=@($c.BoundingRectangle.X,$c.BoundingRectangle.Y,$c.BoundingRectangle.Width,$c.BoundingRectangle.Height)})
   }
   if ($ref -eq $a.ref) { $script:found=$el; return }
   $walker=[Windows.Automation.TreeWalker]::ControlViewWalker
   for ($ch=$walker.GetFirstChild($el);$null -ne $ch;$ch=$walker.GetNextSibling($ch)) { Walk $ch ($depth+1); if ($script:found) { return } }
  } catch [Windows.Automation.ElementNotAvailableException] {}
 }
 if ($a.snapshot -and $a.title) {
  $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,[string]$a.title)
  $root=$root.FindFirst([Windows.Automation.TreeScope]::Children,$condition)
  if (!$root) { throw 'Window not found' }
 }
 Walk $root 0
 if ($a.snapshot) { @{backend='uia';nodes=$script:nodes;truncated=($script:n -ge 200)} | ConvertTo-Json -Depth 8 -Compress; return }
 $el=$script:found
 if (!$el -or $el.Current.Name -cne $a.name) { throw 'Stale accessibility ref; call uia_tree again' }
 if (!$el.Current.IsEnabled) { throw 'Control is disabled' }
 switch ($a.action) {
  'fill' { $p=$el.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern); if ($p.Current.IsReadOnly) { throw 'Control is read only' }; $p.SetValue([string]$a.value); if ($p.Current.Value -cne [string]$a.value) { throw 'Value verification failed' } }
  'select' { $p=$el.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern); $p.Select(); if (!$p.Current.IsSelected) { throw 'Selection verification failed' } }
  'check' { $p=$el.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern); $want=if ($a.checked -eq $false) { 0 } else { 1 }; for ($i=0;$i -lt 3 -and [int]$p.Current.ToggleState -ne $want;$i++) { $p.Toggle() }; if ([int]$p.Current.ToggleState -ne $want) { throw 'Toggle verification failed' } }
  'invoke' { $p=$el.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern); $p.Invoke() }
  default { throw 'Unsupported desktop action' }
 }
 @{ok=$true;action=$a.action;verified=($a.action -ne 'invoke');note='Observe application outcome after invocation'} | ConvertTo-Json -Compress
} catch { @{ok=$false;error=$_.Exception.Message;recovery='Refresh uia_tree in the interactive desktop session or request human takeover'} | ConvertTo-Json -Compress; exit 1 }
`;

export const LINUX_CAPABILITIES = `python3 -c 'import json,os,shutil,importlib.util; wayland=bool(os.getenv("WAYLAND_DISPLAY")); tools=["grim","scrot","xdotool","wmctrl","wtype","ydotool","wl-copy","wl-paste","hyprctl","xclip"]; print(json.dumps(dict(session="wayland" if wayland else "x11",display=os.getenv("WAYLAND_DISPLAY") or os.getenv("DISPLAY"),tools={t:bool(shutil.which(t)) for t in tools},accessibility=bool(importlib.util.find_spec("pyatspi")),note="Tool presence is not a permission check. Accessibility needs an interactive D-Bus session; ydotool needs its daemon and input-device permission.")))'`;
export const WINDOWS_CAPABILITIES = `$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes; $root=[Windows.Automation.AutomationElement]::RootElement; @{backend='uia';interactive=([Environment]::UserInteractive -and (Get-Process -Id $PID).SessionId -gt 0);interactiveTaskBroker=[bool](Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue);windows=$root.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition).Count;note='Outside the desktop, native commands use a limited temporary Scheduled Task. Log in to the guest as the SSH/WinRM user; secure desktop and locked sessions require human takeover.'} | ConvertTo-Json -Compress } catch { Write-Error $_; exit 1 }`;
