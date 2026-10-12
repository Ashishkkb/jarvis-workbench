param(
  [Parameter(Mandatory=$true)][int]$TargetPid,
  [Parameter(Mandatory=$true)][int]$CallerPid,
  [ValidateSet('inspect','stop')][string]$Mode = 'inspect',
  [string]$ExpectedStart = '',
  [string]$ExpectedOwner = '',
  [string]$ExpectedName = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# Native process metadata and termination use one verified Windows kernel handle.
# https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Diagnostics;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Principal;

public class JarvisProcessResult {
  public int pid;
  public string name;
  public string startedAt;
  public string owner;
  public string status;
  public string error;
  public string message;
}
public static class JarvisProcessControl {
  [StructLayout(LayoutKind.Sequential)] struct FT { public uint low; public uint high; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct PE {
    public uint size, usage, id; public UIntPtr heap; public uint module, threads, parent;
    public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out FT created, out FT exited, out FT kernel, out FT user);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder name, ref int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessCritical(IntPtr handle, out bool critical);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr handle, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr handle, uint access, out IntPtr token);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32First(IntPtr snapshot, ref PE entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32Next(IntPtr snapshot, ref PE entry);

  static JarvisProcessResult Fail(int pid, string code, string text) {
    return new JarvisProcessResult { pid=pid, error=code, message=text };
  }
  static bool IsAncestor(int target, int caller) {
    IntPtr snap=CreateToolhelp32Snapshot(2,0);
    if(snap==new IntPtr(-1)) throw new Win32Exception();
    try {
      var parents=new Dictionary<int,int>();
      PE entry=new PE(); entry.size=(uint)Marshal.SizeOf(typeof(PE));
      if(!Process32First(snap,ref entry)) throw new Win32Exception();
      do { parents[(int)entry.id]=(int)entry.parent; } while(Process32Next(snap,ref entry));
      if(!parents.ContainsKey(caller)) throw new Exception("Cannot verify caller ancestry.");
      var visited=new HashSet<int>();
      int current=caller;
      while(current>0) {
        if(current==target) return true;
        if(!visited.Add(current) || visited.Count>128) throw new Exception("Cannot verify caller ancestry.");
        int parent;
        if(!parents.TryGetValue(current,out parent)) break;
        current=parent;
      }
      return target==Process.GetCurrentProcess().Id;
    } finally { CloseHandle(snap); }
  }
  static bool IsCriticalName(string name) {
    string normal=name.ToLowerInvariant().Replace(".exe","");
    return new HashSet<string> {"system","registry","smss","csrss","wininit","winlogon","services","lsass","lsaiso","secure system","memory compression"}.Contains(normal);
  }
  public static JarvisProcessResult Run(int target,int caller,string mode,string expectedStart,string expectedOwner,string expectedName) {
    IntPtr handle=IntPtr.Zero;
    try {
      if(target<=1 || caller<=1) return Fail(target,"INVALID_PID","Choose an individual process with a PID greater than 1.");
      if(IsAncestor(target,caller)) return Fail(target,"PROCESS_PROTECTED","Jarvis and the processes that started it are protected.");
      handle=OpenProcess(0x00100000|0x1000|(mode=="stop"?1u:0u),false,target);
      if(handle==IntPtr.Zero) {
        int code=Marshal.GetLastWin32Error();
        if(code==87) return new JarvisProcessResult { pid=target,status="already-exited" };
        return Fail(target,"PROCESS_METADATA","Windows could not verify or access this process. No process was stopped.");
      }
      if(WaitForSingleObject(handle,0)==0) return new JarvisProcessResult { pid=target,status="already-exited" };
      FT creation,exit,kernel,user;
      if(!GetProcessTimes(handle,out creation,out exit,out kernel,out user)) throw new Win32Exception();
      string start=(((ulong)creation.high<<32)|creation.low).ToString(System.Globalization.CultureInfo.InvariantCulture);
      var image=new StringBuilder(32768); int length=image.Capacity;
      if(!QueryFullProcessImageName(handle,0,image,ref length)) throw new Win32Exception();
      string name=System.IO.Path.GetFileNameWithoutExtension(image.ToString());
      IntPtr token;
      if(!OpenProcessToken(handle,8,out token)) throw new Win32Exception();
      string owner;
      try { using(var identity=new WindowsIdentity(token)) { owner=identity.User.Value; } }
      finally { CloseHandle(token); }
      string currentOwner;
      using(var current=WindowsIdentity.GetCurrent()) { currentOwner=current.User.Value; }
      if(owner!=currentOwner) return Fail(target,"PROCESS_OTHER_USER","Only processes owned by your current user can be stopped.");
      bool critical;
      if(!IsProcessCritical(handle,out critical)) throw new Win32Exception();
      if(critical || IsCriticalName(name)) return Fail(target,"PROCESS_PROTECTED","This operating-system process is protected.");
      var result=new JarvisProcessResult {pid=target,name=name,startedAt=start,owner=owner,status="running"};
      if(mode=="stop") {
        if(start!=expectedStart || owner!=expectedOwner || name!=expectedName) return Fail(target,"PROCESS_CHANGED","The process changed since review. Refresh and review it again.");
        // Use the same verified kernel handle, never look up the PID again.
        if(WaitForSingleObject(handle,0)==0) { result.status="already-exited"; return result; }
        if(!TerminateProcess(handle,1)) {
          if(WaitForSingleObject(handle,0)==0) {result.status="already-exited"; return result;}
          return Fail(target,"PROCESS_STOP_FAILED","Windows refused to stop the selected process.");
        }
        result.status=WaitForSingleObject(handle,2000)==0?"stopped":"requested";
      }
      return result;
    } catch(Exception) {
      return Fail(target,"PROCESS_METADATA","Windows could not safely verify this process. No further action was taken.");
    } finally { if(handle!=IntPtr.Zero) CloseHandle(handle); }
  }
}
'@
[JarvisProcessControl]::Run($TargetPid,$CallerPid,$Mode,$ExpectedStart,$ExpectedOwner,$ExpectedName) | ConvertTo-Json -Compress
