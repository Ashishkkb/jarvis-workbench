param(
  [ValidateSet('status','connect','disconnect','dns','dns-auto','password')][string]$Mode = 'status',
  [string]$AdapterId = '',
  [string]$ProfileBase64 = '',
  [string]$DnsServers = ''
)
$ErrorActionPreference = 'Stop'
# Native WLAN contracts: https://learn.microsoft.com/windows/win32/api/wlanapi/
# Profile XML is read in memory only for an explicitly requested password reveal.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -ReferencedAssemblies 'System.dll','System.Xml.dll' -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Xml;
using System.IO;

public class JarvisWifiProfile { public string name; public string adapterId; public string interfaceName; }
public class JarvisWifiInterface { public string id; public string name; public string profile; public int state; }
public class JarvisWifiState { public List<JarvisWifiInterface> interfaces=new List<JarvisWifiInterface>(); public List<JarvisWifiProfile> profiles=new List<JarvisWifiProfile>(); public string warning; }
public class JarvisWifiError : Exception { public uint Code; public JarvisWifiError(uint code) { Code=code; } }
public static class JarvisWifi {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct IFACE { public Guid id; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string description; public int state; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct PROFILE { [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string name; public uint flags; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct CONNECTION_HEAD { public int state,mode; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string profile; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct CONNECT { public int mode; [MarshalAs(UnmanagedType.LPWStr)] public string profile; public IntPtr ssid,bssid; public int type; public uint flags; }
  [DllImport("wlanapi.dll")] static extern uint WlanOpenHandle(uint version,IntPtr reserved,out uint negotiated,out IntPtr handle);
  [DllImport("wlanapi.dll")] static extern uint WlanCloseHandle(IntPtr handle,IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern uint WlanEnumInterfaces(IntPtr handle,IntPtr reserved,out IntPtr list);
  [DllImport("wlanapi.dll")] static extern uint WlanGetProfileList(IntPtr handle,ref Guid id,IntPtr reserved,out IntPtr list);
  [DllImport("wlanapi.dll")] static extern uint WlanQueryInterface(IntPtr handle,ref Guid id,int opcode,IntPtr reserved,out uint size,out IntPtr data,out int type);
  [DllImport("wlanapi.dll", CharSet=CharSet.Unicode)] static extern uint WlanGetProfile(IntPtr handle,ref Guid id,string profile,IntPtr reserved,out IntPtr xml,ref uint flags,out uint access);
  [DllImport("wlanapi.dll")] static extern uint WlanConnect(IntPtr handle,ref Guid id,ref CONNECT parameters,IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern uint WlanDisconnect(IntPtr handle,ref Guid id,IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memory);
  static void Check(uint code) { if(code!=0) throw new JarvisWifiError(code); }
  static IntPtr Open() { uint version; IntPtr handle; Check(WlanOpenHandle(2,IntPtr.Zero,out version,out handle)); return handle; }
  static List<IFACE> Interfaces(IntPtr handle) {
    IntPtr list; Check(WlanEnumInterfaces(handle,IntPtr.Zero,out list));
    try {
      int count=Marshal.ReadInt32(list); if(count<0 || count>1024) throw new Exception();
      int stride=Marshal.SizeOf(typeof(IFACE)); var result=new List<IFACE>();
      for(int i=0;i<count;i++) result.Add((IFACE)Marshal.PtrToStructure(IntPtr.Add(list,8+i*stride),typeof(IFACE)));
      return result;
    } finally { WlanFreeMemory(list); }
  }
  static List<PROFILE> Profiles(IntPtr handle,Guid id) {
    IntPtr list; Check(WlanGetProfileList(handle,ref id,IntPtr.Zero,out list));
    try {
      int count=Marshal.ReadInt32(list); if(count<0 || count>4096) throw new Exception();
      int stride=Marshal.SizeOf(typeof(PROFILE)); var result=new List<PROFILE>();
      for(int i=0;i<count;i++) result.Add((PROFILE)Marshal.PtrToStructure(IntPtr.Add(list,8+i*stride),typeof(PROFILE)));
      return result;
    } finally { WlanFreeMemory(list); }
  }
  public static JarvisWifiState Status() {
    var result=new JarvisWifiState(); IntPtr handle=IntPtr.Zero;
    try {
      handle=Open();
      foreach(var item in Interfaces(handle)) {
        Guid id=item.id;
        var current=new JarvisWifiInterface {id=id.ToString(),name=item.description,state=item.state};
        IntPtr data; uint size; int type;
        if(WlanQueryInterface(handle,ref id,7,IntPtr.Zero,out size,out data,out type)==0) {
          try { if(size>=Marshal.SizeOf(typeof(CONNECTION_HEAD))) current.profile=((CONNECTION_HEAD)Marshal.PtrToStructure(data,typeof(CONNECTION_HEAD))).profile; }
          finally { WlanFreeMemory(data); }
        }
        result.interfaces.Add(current);
        try {
          foreach(var profile in Profiles(handle,id)) result.profiles.Add(new JarvisWifiProfile {name=profile.name,adapterId=id.ToString(),interfaceName=item.description});
        } catch { result.warning="Some saved Wi-Fi profiles are unavailable under current Windows permissions."; }
      }
    } catch { result.warning="Wi-Fi information is unavailable. Check the wireless adapter, WLAN AutoConfig service, and Windows permissions."; }
    finally { if(handle!=IntPtr.Zero) WlanCloseHandle(handle,IntPtr.Zero); }
    return result;
  }
  public static string Action(string action,string adapter,string profile) {
    Guid id=new Guid(adapter); IntPtr handle=Open();
    try {
      bool found=false; foreach(var item in Interfaces(handle)) if(item.id==id) found=true;
      if(!found) throw new JarvisWifiError(1168);
      if(action=="disconnect") { Check(WlanDisconnect(handle,ref id,IntPtr.Zero)); return null; }
      bool saved=false; foreach(var item in Profiles(handle,id)) if(item.name==profile) saved=true;
      if(!saved) throw new JarvisWifiError(1168);
      if(action=="connect") {
        CONNECT parameters=new CONNECT {mode=0,profile=profile,ssid=IntPtr.Zero,bssid=IntPtr.Zero,type=1,flags=0};
        Check(WlanConnect(handle,ref id,ref parameters,IntPtr.Zero)); return null;
      }
      if(action!="password") throw new Exception();
      IntPtr xml; uint flags=4,access;
      Check(WlanGetProfile(handle,ref id,profile,IntPtr.Zero,out xml,ref flags,out access));
      try {
        // Parse in memory only; disable external entities. The full profile is never emitted.
        var settings=new XmlReaderSettings {DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=1048576};
        var document=new XmlDocument(); document.XmlResolver=null;
        using(var reader=XmlReader.Create(new StringReader(Marshal.PtrToStringUni(xml)),settings)) document.Load(reader);
        var key=document.SelectSingleNode("//*[local-name()='sharedKey']");
        if(key==null) throw new JarvisWifiError(1168);
        var protection=key.SelectSingleNode("*[local-name()='protected']");
        if(protection==null || protection.InnerText!="false") throw new JarvisWifiError(5);
        var material=key.SelectSingleNode("*[local-name()='keyMaterial']");
        if(material==null || String.IsNullOrEmpty(material.InnerText)) throw new JarvisWifiError(1168);
        return material.InnerText;
      } finally { WlanFreeMemory(xml); }
    } finally { WlanCloseHandle(handle,IntPtr.Zero); }
  }
}
'@
try {
  if ($Mode -eq 'status') {
    $wifi = [JarvisWifi]::Status()
    $rows = @()
    foreach ($network in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      $guidValue = [guid]::Empty
      if (-not [guid]::TryParse($network.Id, [ref]$guidValue)) { continue }
      $id = $guidValue.ToString()
      $ip = $network.GetIPProperties()
      $v4 = $null
      try { $v4 = $ip.GetIPv4Properties() } catch {}
      $wireless = @($wifi.interfaces | Where-Object { $_.id -eq $id }) | Select-Object -First 1
      $rows += [ordered]@{
        id=$id; name=$network.Name; description=$network.Description; status=$network.OperationalStatus.ToString()
        mac=$network.GetPhysicalAddress().ToString()
        addresses=@($ip.UnicastAddresses | ForEach-Object { $_.Address.ToString() })
        gateway=@($ip.GatewayAddresses | ForEach-Object { $_.Address.ToString() })
        dns=@($ip.DnsAddresses | Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.ToString() })
        dnsIpv6=@($ip.DnsAddresses | Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6 } | ForEach-Object { $_.ToString() })
        dhcp=if($v4){$v4.IsDhcpEnabled}else{$null}
        wifi=($null -ne $wireless -or $network.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Wireless80211)
        profile=if($wireless){$wireless.profile}else{$null}
      }
    }
    @{available=$true;adapters=@($rows);profiles=@($wifi.profiles);warning=$wifi.warning} | ConvertTo-Json -Compress -Depth 8
  } elseif ($Mode -eq 'dns' -or $Mode -eq 'dns-auto') {
    $selectedGuid = [guid]$AdapterId
    $adapter = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { $_.InterfaceGuid -eq $selectedGuid })
    if ($adapter.Count -ne 1) { throw 'Adapter unavailable.' }
    $configuration = @(Get-DnsClientServerAddress -InterfaceIndex $adapter[0].ifIndex -AddressFamily IPv4 -ErrorAction Stop)
    if ($configuration.Count -ne 1) { throw 'IPv4 DNS configuration unavailable.' }
    if ($Mode -eq 'dns-auto') {
      $configuration[0] | Set-DnsClientServerAddress -ResetServerAddresses -ErrorAction Stop
    } else {
      $addresses = @($DnsServers.Split(','))
      if ($addresses.Count -lt 1 -or $addresses.Count -gt 4) { throw 'Invalid DNS count.' }
      foreach ($address in $addresses) {
        $parsed = [System.Net.IPAddress]::Parse($address)
        if ($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'IPv4 required.' }
      }
      $configuration[0] | Set-DnsClientServerAddress -ServerAddresses $addresses -ErrorAction Stop
    }
    @{status='applied';message='IPv4 DNS settings were applied.'} | ConvertTo-Json -Compress
  } else {
    $profile = if ($ProfileBase64) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ProfileBase64)) } else { '' }
    $result = [JarvisWifi]::Action($Mode,$AdapterId,$profile)
    if ($Mode -eq 'password') { @{password=$result} | ConvertTo-Json -Compress }
    else { @{status='requested';message='Windows accepted the Wi-Fi request. Refresh to check the connection.'} | ConvertTo-Json -Compress }
  }
} catch {
  # Do not include exception content: native Wi-Fi profile XML can contain a secret.
  $kind = 'NETWORK_FAILED'
  $message = 'Windows could not complete this request. Check that the adapter is available and your account has permission. Jarvis does not automatically elevate privileges.'
  $cause = $_.Exception
  while ($cause.InnerException) { $cause = $cause.InnerException }
  if ($Mode -eq 'password') {
    $kind = 'WIFI_PASSWORD_UNAVAILABLE'
    $message = 'Windows did not provide a saved shared password. This may be an enterprise/open network or Windows may require administrator permission.'
  } elseif ($cause -is [JarvisWifiError] -and $cause.Code -eq 1168) {
    $kind = 'NETWORK_CHANGED'
    $message = 'The selected adapter or saved profile is no longer available. Refresh and review the change again.'
  }
  @{error=$kind;message=$message} | ConvertTo-Json -Compress
}
