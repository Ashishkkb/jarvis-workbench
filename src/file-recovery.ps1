param([Parameter(Mandatory=$true)][string]$PathBase64)
$ErrorActionPreference = 'Stop'
try {
  $target = [IO.Path]::GetFullPath([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PathBase64)))
  if ($target -eq [IO.Path]::GetPathRoot($target)) { throw 'Recovery cannot use a drive root.' }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $allowed = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
  if (-not [IO.Directory]::Exists($target)) {
    # Create with the restrictive descriptor in the same native operation: no public interval.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($user)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in $allowed) {
      $identity = New-Object Security.Principal.SecurityIdentifier($sid)
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    [void][IO.Directory]::CreateDirectory($target, $acl)
  }
  $item = Get-Item -LiteralPath $target -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Recovery must be a regular directory.' }
  $actual = Get-Acl -LiteralPath $target
  if (-not $actual.AreAccessRulesProtected) { throw 'Existing recovery directory inherits access from other users. Choose a new private recovery folder.' }
  $owner = $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($allowed -notcontains $owner) { throw 'Recovery directory has another owner.' }
  foreach ($rule in $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) { throw 'Recovery directory is accessible to another user. Its permissions were left unchanged.' }
  }
  @{ private = $true } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine('Cannot use private recovery storage: ' + $_.Exception.Message)
  exit 1
}
