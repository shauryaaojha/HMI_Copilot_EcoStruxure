<#
  Open a project in the licensed EcoStruxure Operator Terminal Expert 4.4 on
  this machine, simulate it, and report what the product itself said.

    powershell -ExecutionPolicy Bypass -File scripts/ote-bench.ps1 -Project <file.eote> [-Out <dir>] [-Wait 120] [-Keep]

  OTE has no command line and no API, so this drives the editor through
  Windows UI Automation - the accessibility tree - rather than the keyboard
  or the screen. That matters: it works when the session is not on the
  interactive desktop (no focus, no SendKeys, no CopyFromScreen), which is how
  a coding agent's shell runs. Screenshots use PrintWindow, which renders the
  window itself rather than copying pixels off a screen.

  What it reports, as JSON:
    opened      the Project Explorer shows the project
    explorer    the counts OTE itself shows (screens, contents, variables, alarms...)
    simulated   the simulator process (PCPlatform.exe) started
    dialogs     the text of any window the editor raised (an error, a validation list)
    errors      the rows of the editor's Errors pane
    shots       PNGs of each stage

  Only processes this script started are touched, by PID. An editor the
  engineer already has open is never closed or focused.
#>
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$Out = "$env:TEMP\claude\ote-bench",
  [int]$Wait = 120,
  [switch]$Keep
)

$ErrorActionPreference = "Stop"
$exe = "C:\Program Files\Schneider Electric\EcoStruxure Operator Terminal Expert 4.4\Buildtime\EcoStruxure Operator Terminal Expert.exe"
$Project = (Resolve-Path $Project).Path
$name = [IO.Path]::GetFileNameWithoutExtension($Project) -replace "[^A-Za-z0-9_.-]", "_"
New-Item -ItemType Directory -Force $Out | Out-Null

Add-Type -AssemblyName System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Bench {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> WindowsOf(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, p) => { uint q; GetWindowThreadProcessId(h, out q); if (q == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
"@
$TS = [Windows.Automation.TreeScope]
$Any = [Windows.Automation.Condition]::TrueCondition
$AE = [Windows.Automation.AutomationElement]

function Shot([IntPtr]$h, [string]$file) {
  try {
    $r = New-Object Bench+RECT
    [Bench]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = [Math]::Max(1, $r.R - $r.L); $hh = [Math]::Max(1, $r.B - $r.T)
    $bmp = New-Object Drawing.Bitmap $w, $hh
    $g = [Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
    [Bench]::PrintWindow($h, $hdc, 2) | Out-Null
    $g.ReleaseHdc($hdc); $g.Dispose(); $bmp.Save($file); $bmp.Dispose()
    return $file
  } catch { return $null }
}

function All($el) {
  # Every descendant, retried: see Texts.
  for ($try = 0; $try -lt 4; $try++) {
    try { return @($el.FindAll($TS::Descendants, $Any)) } catch { Start-Sleep -Seconds 2 }
  }
  return @()
}

function Texts($el) {
  if (-not $el) { return @() }
  # UI Automation throws "Unrecognized error" now and then while the editor is
  # rebuilding its tree (a large project still loading): try again, then give up quietly.
  for ($try = 0; $try -lt 4; $try++) {
    try {
      return $el.FindAll($TS::Descendants, $Any) | ForEach-Object { try { $_.Current.Name } catch {} } | Where-Object { $_ -and $_.Trim() -and $_ -notmatch "^(Xceed|Buildtime)\." } | Select-Object -Unique
    } catch { Start-Sleep -Seconds 2 }
  }
  return @()
}

function Explorer($root) {
  $counts = [ordered]@{}
  foreach ($t in (Texts $root)) {
    if ($t -match "^(Screens|Contents|All Variables|All Alarms|All Loggings|All Users|User-Defined Converters|Structure|Array|All Scan Rates) \((\d+)\)$") { $counts[$Matches[1]] = [int]$Matches[2] }
  }
  return $counts
}

$beforeSim = @(Get-Process PCPlatform -ErrorAction SilentlyContinue | ForEach-Object Id)
$started = Get-Date
$p = Start-Process -FilePath $exe -ArgumentList "`"$Project`"" -PassThru
$result = [ordered]@{ project = $Project; editorPid = $p.Id; opened = $false; convertPrompt = $false; notes = @(); explorer = @{}; simulated = $false; dialogs = @(); errors = @(); problems = @(); shots = @(); seconds = 0 }

try {
  # --- open: the Project Explorer lists the project's screens -------------
  $root = $null
  $deadline = (Get-Date).AddSeconds($Wait)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $p.Refresh()
    if ($p.HasExited) { throw "the editor exited while opening the project" }
    if ($p.MainWindowHandle -eq 0) { continue }
    $root = $AE::FromHandle($p.MainWindowHandle)
    $c = Explorer $root
    if ($c.Contains("Screens")) { $result.opened = $true; $result.explorer = $c; break }
    # A dialog instead of the project. The one seen in practice is the
    # version prompt - "The project file was edited in version ... convert the
    # project file to version 4.4?" - raised for any file whose
    # VersionModified is older than the installed build. It is recorded (an
    # engineer would see it too) and answered Yes, as they would.
    foreach ($h in [Bench]::WindowsOf([uint32]$p.Id)) {
      if ($h -eq $p.MainWindowHandle) { continue }
      $dlg = $AE::FromHandle($h)
      $title = $dlg.Current.Name
      # "Opening Project" is the progress window, not a question: keep waiting.
      $answer = (All $dlg) | Where-Object { $_.Current.AutomationId -in @("PART_YesButton", "PART_OKButton", "PART_NoButton") -and -not $_.Current.IsOffscreen }
      if (-not $answer) { continue }
      $result.shots += Shot $h "$Out\$name-open-dialog.png"
      $yes = $dlg.FindFirst($TS::Descendants, (New-Object Windows.Automation.PropertyCondition($AE::AutomationIdProperty, "PART_YesButton")))
      $ok = $dlg.FindFirst($TS::Descendants, (New-Object Windows.Automation.PropertyCondition($AE::AutomationIdProperty, "PART_OKButton")))
      if ($title -eq "Open Project" -and $yes -and -not $result.convertPrompt) {
        $result.convertPrompt = $true
        $yes.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
      } elseif ($title -eq "Information" -and $ok -and -not $ok.Current.IsOffscreen) {
        # After a conversion the editor recommends security settings (lockout,
        # complex password, no always-on Ethernet transfer, a project
        # password). Advice, not a fault: noted and acknowledged.
        $result.notes += "Information: security recommendations shown on open"
        $ok.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
      } else {
        $result.dialogs += ,@(@($title) + @(Texts $dlg))
      }
    }
    if ($result.dialogs.Count -gt 0) { break }
  }
  $result.shots += Shot $p.MainWindowHandle "$Out\$name-1-opened.png"
  if (-not $result.opened) { throw "the project did not open within $Wait s" }
  Start-Sleep -Seconds 3

  # --- simulate: the toolbar's Simulate split button ------------------------
  $simItem = (All $root) | Where-Object { $_.Current.HelpText -like "Simulate and verify*" } | Select-Object -First 1
  if (-not $simItem) { throw "no Simulate button in the editor" }
  $primary = $simItem.FindFirst($TS::Descendants, (New-Object Windows.Automation.PropertyCondition($AE::AutomationIdProperty, "PrimaryFunctionButton")))
  $primary.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()

  $deadline = (Get-Date).AddSeconds($Wait)
  $sim = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $sim = Get-Process PCPlatform -ErrorAction SilentlyContinue | Where-Object { $beforeSim -notcontains $_.Id } | Select-Object -First 1
    if ($sim) { break }
    # "Validating Project Data" and "Building" are progress windows; only a
    # window that asks something (OK / Yes / No) ends the wait.
    $asking = $false
    foreach ($h in ([Bench]::WindowsOf([uint32]$p.Id) | Where-Object { $_ -ne $p.MainWindowHandle })) {
      $dlg = $AE::FromHandle($h)
      $answer = (All $dlg) | Where-Object { $_.Current.AutomationId -in @("PART_YesButton", "PART_OKButton", "PART_NoButton") -and -not $_.Current.IsOffscreen }
      if (-not $answer) { continue }
      $okBtn = $answer | Where-Object { $_.Current.AutomationId -eq "PART_OKButton" } | Select-Object -First 1
      if ($dlg.Current.Name -eq "Information" -and $okBtn) {
        $result.notes += "Information during simulate: " + ((Texts $dlg | Where-Object { $_ -notin @("OK", "Cancel", "Yes", "No", "Information") }) -join " ")
        $okBtn.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        continue
      }
      $asking = $true
      $result.dialogs += ,@(@($dlg.Current.Name) + @(Texts $dlg))
      $result.shots += Shot $h "$Out\$name-dialog-$($result.dialogs.Count).png"
    }
    if ($asking) { break }
  }
  Start-Sleep -Seconds 8
  $result.shots += Shot $p.MainWindowHandle "$Out\$name-2-after-simulate.png"
  if ($sim) {
    $result.simulated = $true
    $sim.Refresh()
    $hs = [Bench]::WindowsOf([uint32]$sim.Id)
    if ($hs.Count -gt 0) {
      $result.shots += Shot $hs[0] "$Out\$name-3-simulator.png"
      # And once more after the runtime has settled: a screen's bindings can
      # take a while to start on a busy screen, and the first picture is then
      # the parts' design state, not the tags'.
      Start-Sleep -Seconds 20
      $result.shots += Shot $hs[0] "$Out\$name-3-simulator-settled.png"
    }
  }

  # --- the Errors pane, as the editor shows it ------------------------------
  # The pane is a collapsed tab at the bottom: select it, and what text
  # appears that was not there before is the pane's content.
  $root = $AE::FromHandle($p.MainWindowHandle)
  $beforeTexts = @(Texts $root)
  $tab = (All $root) | Where-Object {
    $_.Current.ControlType -eq [Windows.Automation.ControlType]::TabItem -and
    (@(Texts $_) -contains "Errors")
  } | Select-Object -First 1
  if ($tab) {
    try { $tab.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select() } catch {}
    Start-Sleep -Seconds 2
    $after = @(Texts ($AE::FromHandle($p.MainWindowHandle)))
    $result.errors = @($after | Where-Object { $beforeTexts -notcontains $_ })
    $result.shots += Shot $p.MainWindowHandle "$Out\$name-4-errors.png"
  }
}
catch {
  $result.problems += $_.Exception.Message
}
finally {
  $result.seconds = [int]((Get-Date) - $started).TotalSeconds
  $result.shots = @($result.shots | Where-Object { $_ })
  if (-not $Keep) {
    Get-Process PCPlatform -ErrorAction SilentlyContinue | Where-Object { $beforeSim -notcontains $_.Id } | ForEach-Object { Stop-Process -Id $_.Id -Force }
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  }
}
$result | ConvertTo-Json -Depth 5
