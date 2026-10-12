param([Parameter(Mandatory=$true)][string]$PathBase64)
$ErrorActionPreference = 'Stop'
try {
  $target = [IO.Path]::GetFullPath([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PathBase64)))
  if ($target -eq [IO.Path]::GetPathRoot($target)) { throw 'Recovery cannot use a drive root.' }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $allowed = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
  if (-not [IO.Directory]::Exists($target)) {
    # Create with the restrictive descriptor in the same native operation: no public interval.
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($user)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in $allowed) {
      $identity = [Security.Principal.SecurityIdentifier]::new($sid)
      $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    [void][IO.Directory]::CreateDirectory($target, $acl)
  }
  # Use .NET directly: a parent PowerShell 7 session can provide incompatible
  # PSModulePath entries to Windows PowerShell 5.1. ACL enforcement must not
  # depend on module discovery, profiles, or Get-Acl auto-loading.
  $attributes = [IO.File]::GetAttributes($target)
  if (-not ($attributes -band [IO.FileAttributes]::Directory) -or ($attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Recovery must be a regular directory.' }
  $actual = [IO.DirectoryInfo]::new($target).GetAccessControl()
  if (-not $actual.AreAccessRulesProtected) { throw 'Existing recovery directory inherits access from other users. Choose a new private recovery folder.' }
  $owner = $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($allowed -notcontains $owner) { throw 'Recovery directory has another owner.' }
  foreach ($rule in $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) { throw 'Recovery directory is accessible to another user. Its permissions were left unchanged.' }
  }
  [Console]::Out.WriteLine('{"private":true}')
} catch {
  [Console]::Error.WriteLine('Cannot use private recovery storage: ' + $_.Exception.Message)
  exit 1
}
