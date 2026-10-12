param(
  [ValidateSet('status','set')][string]$Mode = 'status',
  [double]$Volume = -1,
  [ValidateSet(-1,0,1)][int]$Mute = -1
)
$ErrorActionPreference = 'Stop'
# Documented Core Audio only; no private policy interfaces for switching defaults.
# https://learn.microsoft.com/windows/win32/api/endpointvolume/nn-endpointvolume-iaudioendpointvolume
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class JarvisDeviceEnumerator {}
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface JarvisIMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int flow,uint mask,out JarvisIMMDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow,int role,out JarvisIMMDevice device);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out JarvisIMMDevice device);
  [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
  [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
}
[ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface JarvisIMMDeviceCollection {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int Item(uint index,out JarvisIMMDevice device);
}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface JarvisIMMDevice {
  [PreserveSig] int Activate(ref Guid iid,uint context,IntPtr activation,[MarshalAs(UnmanagedType.IUnknown)]out object obj);
  [PreserveSig] int OpenPropertyStore(uint access,out JarvisPropertyStore store);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id);
  [PreserveSig] int GetState(out uint state);
}
[StructLayout(LayoutKind.Sequential)] struct JarvisPropertyKey { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Explicit,Size=24)] struct JarvisPropVariant {
  [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr value;
}
[ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface JarvisPropertyStore {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index,out JarvisPropertyKey key);
  [PreserveSig] int GetValue(ref JarvisPropertyKey key,out JarvisPropVariant value);
  [PreserveSig] int SetValue(ref JarvisPropertyKey key,ref JarvisPropVariant value);
  [PreserveSig] int Commit();
}
[ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface JarvisEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr callback);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr callback);
  [PreserveSig] int GetChannelCount(out uint count);
  [PreserveSig] int SetMasterVolumeLevel(float level,ref Guid context);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level,ref Guid context);
  [PreserveSig] int GetMasterVolumeLevel(out float level);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig] int SetChannelVolumeLevel(uint channel,float level,ref Guid context);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint channel,float level,ref Guid context);
  [PreserveSig] int GetChannelVolumeLevel(uint channel,out float level);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint channel,out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)]bool mute,ref Guid context);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)]out bool mute);
  [PreserveSig] int GetVolumeStepInfo(out uint step,out uint count);
  [PreserveSig] int VolumeStepUp(ref Guid context);
  [PreserveSig] int VolumeStepDown(ref Guid context);
  [PreserveSig] int QueryHardwareSupport(out uint mask);
  [PreserveSig] int GetVolumeRange(out float min,out float max,out float increment);
}
public class JarvisAudioDevice { public string id,name,kind; public bool isDefault; }
public class JarvisAudioState {
  public bool available; public double? volume; public bool? muted; public bool canSelectDevice=false;
  public string warning; public List<JarvisAudioDevice> devices=new List<JarvisAudioDevice>();
}
public static class JarvisAudio {
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref JarvisPropVariant value);
  static void Check(int result) { Marshal.ThrowExceptionForHR(result); }
  static void Release(object obj) { if(obj!=null && Marshal.IsComObject(obj)) Marshal.ReleaseComObject(obj); }
  static string Name(JarvisIMMDevice device) {
    JarvisPropertyStore store=null;
    try {
      Check(device.OpenPropertyStore(0,out store));
      JarvisPropertyKey key=new JarvisPropertyKey {fmtid=new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),pid=14};
      JarvisPropVariant value; Check(store.GetValue(ref key,out value));
      try { return value.type==31?Marshal.PtrToStringUni(value.value):"Audio device"; }
      finally { PropVariantClear(ref value); }
    } finally { Release(store); }
  }
  public static JarvisAudioState Run(bool change,double requestedVolume,int requestedMute) {
    if(change && ((requestedVolume!=-1 && (Double.IsNaN(requestedVolume) || Double.IsInfinity(requestedVolume) || requestedVolume<0 || requestedVolume>100)) || requestedMute < -1 || requestedMute>1)) throw new ArgumentException();
    JarvisIMMDeviceEnumerator enumerator=null;
    var result=new JarvisAudioState();
    try {
      enumerator=(JarvisIMMDeviceEnumerator)(new JarvisDeviceEnumerator());
      for(int flow=0;flow<=1;flow++) {
        JarvisIMMDevice defaultDevice=null;
        string defaultId=null;
        try {
          if(enumerator.GetDefaultAudioEndpoint(flow,1,out defaultDevice)>=0) {
            Check(defaultDevice.GetId(out defaultId));
            if(flow==0) {
              object endpoint=null;
              try {
                Guid iid=typeof(JarvisEndpointVolume).GUID;
                Check(defaultDevice.Activate(ref iid,23,IntPtr.Zero,out endpoint));
                var volume=(JarvisEndpointVolume)endpoint;
                Guid context=new Guid("5B2AEF4E-1CA7-49CF-81B9-829186A6CB01");
                if(change) {
                  if(requestedVolume>=0) Check(volume.SetMasterVolumeLevelScalar((float)(requestedVolume/100.0),ref context));
                  if(requestedMute>=0) Check(volume.SetMute(requestedMute==1,ref context));
                }
                float level; bool muted;
                Check(volume.GetMasterVolumeLevelScalar(out level)); Check(volume.GetMute(out muted));
                result.volume=Math.Round(level*100,1); result.muted=muted; result.available=true;
              } finally { Release(endpoint); }
            }
          }
        } finally { Release(defaultDevice); }
        JarvisIMMDeviceCollection collection=null;
        try {
          Check(enumerator.EnumAudioEndpoints(flow,1,out collection));
          uint count; Check(collection.GetCount(out count));
          if(count>4096) throw new Exception();
          for(uint i=0;i<count;i++) {
            JarvisIMMDevice device=null;
            try {
              Check(collection.Item(i,out device));
              string id; Check(device.GetId(out id));
              result.devices.Add(new JarvisAudioDevice {id=id,name=Name(device),kind=flow==0?"output":"input",isDefault=id==defaultId});
            } finally { Release(device); }
          }
        } finally { Release(collection); }
      }
      if(!result.available) result.warning="No default output device is available. Choose an output in Windows sound settings.";
      return result;
    } finally { Release(enumerator); }
  }
}
'@
try {
  [JarvisAudio]::Run(($Mode -eq 'set'),$Volume,$Mute) | ConvertTo-Json -Compress -Depth 5
} catch {
  @{error='AUDIO_FAILED';message='Windows could not access this sound device. Check the audio device and Windows Audio service, then refresh.'} | ConvertTo-Json -Compress
}
