<#
  ote-bench.ps1 over every .eote under the given paths, one editor at a time,
  one JSON line per project in -Report.

    powershell -ExecutionPolicy Bypass -File scripts/ote-bench-all.ps1 -Paths <dir|file>[,...] [-Report bench.jsonl] [-Wait 150]
#>
param(
  [Parameter(Mandatory = $true)][string[]]$Paths,
  [string]$Report = "$env:TEMP\claude\ote-bench\bench.jsonl",
  [int]$Wait = 150
)
$bench = Join-Path $PSScriptRoot "ote-bench.ps1"
$files = foreach ($p in $Paths) { if (Test-Path $p -PathType Container) { Get-ChildItem $p -Recurse -Filter *.eote | Where-Object { $_.Name -notmatch "_backup_\d+\.eote$" } | ForEach-Object FullName } else { (Resolve-Path $p).Path } }
New-Item -ItemType Directory -Force (Split-Path $Report) | Out-Null
Remove-Item $Report -ErrorAction SilentlyContinue
foreach ($f in $files) {
  $json = & powershell -ExecutionPolicy Bypass -File $bench -Project $f -Wait $Wait | Out-String
  try { $r = $json | ConvertFrom-Json } catch { $r = [pscustomobject]@{ project = $f; problems = @("bench output was not JSON: $json") } }
  ($r | ConvertTo-Json -Depth 6 -Compress) | Add-Content $Report
  $state = if ($r.simulated) { "SIMULATED" } elseif ($r.opened) { "OPENED" } else { "FAILED" }
  "{0,-10} prompt={1,-5} errors={2,-3} {3}  {4}" -f $state, $r.convertPrompt, @($r.errors).Count, (Split-Path $f -Leaf), (($r.problems + $r.dialogs) -join " | ")
}
