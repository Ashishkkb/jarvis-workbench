param([ValidateSet('cpu','memory','board','gpu','storage','battery','network','ports','cooling','os')][string]$Probe)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# Each section is flushed independently: completed readings survive later provider failures.
# Node bounds each process (CPU 8s, other probes 6s); CIM has its own deadline.
# Contracts: learn.microsoft.com/windows-hardware/drivers/storage/msft-storagereliabilitycounter
# learn.microsoft.com/windows/win32/api/batclass/ns-batclass-battery_wmi_static_data
# learn.microsoft.com/windows-hardware/design/device-experiences/ioctl-thermal-read-temperature
function Read-Section([string]$Name, [scriptblock]$Query) {
  try {
    $rows = @(& $Query | Select-Object -First 257)
    $result = @{ section=$Name; ok=$true; truncated=($rows.Count -gt 256); data=@($rows | Select-Object -First 256) }
  } catch { $result = @{ section=$Name; ok=$false; data=@() } }
  [Console]::WriteLine((ConvertTo-Json -InputObject $result -Depth 5 -Compress))
}
function Read-Cim([string]$Class, [string[]]$Properties, [string]$Namespace='root/cimv2', [string]$Filter='') {
  $arguments = @{ ClassName=$Class; Namespace=$Namespace; Property=$Properties; OperationTimeoutSec=$(if ($Probe -eq 'cpu') { 4 } else { 2 }); ErrorAction='Stop' }
  if ($Filter) { $arguments.Filter = $Filter }
  Get-CimInstance @arguments | Select-Object -Property $Properties
}
switch ($Probe) {
  'cpu' {
    Read-Section 'cpu' { Read-Cim 'Win32_Processor' @('Name','Manufacturer','NumberOfCores','NumberOfLogicalProcessors','MaxClockSpeed','CurrentClockSpeed','LoadPercentage','Status') }
  }
  'memory' {
    Read-Section 'memory' { Read-Cim 'Win32_PhysicalMemory' @('DeviceLocator','BankLabel','Capacity','ConfiguredClockSpeed','Speed','Manufacturer','SMBIOSMemoryType','FormFactor') }
    Read-Section 'memoryArrays' { Read-Cim 'Win32_PhysicalMemoryArray' @('MemoryDevices','MaxCapacityEx','MemoryErrorCorrection') }
  }
  'board' {
    Read-Section 'board' { Read-Cim 'Win32_BaseBoard' @('Manufacturer','Product','Version','Status') }
    Read-Section 'bios' { Read-Cim 'Win32_BIOS' @('Manufacturer','SMBIOSBIOSVersion','Status') }
  }
  'gpu' {
    # AdapterRAM is deliberately omitted: Win32_VideoController uses a 32-bit value
    # and is unreliable for modern dedicated/shared VRAM capacities.
    Read-Section 'gpu' { Read-Cim 'Win32_VideoController' @('Name','DriverVersion','VideoProcessor','CurrentHorizontalResolution','CurrentVerticalResolution','CurrentRefreshRate','ConfigManagerErrorCode','Status') }
  }
  'storage' {
    Read-Section 'volumes' { Read-Cim 'Win32_LogicalDisk' @('DeviceID','VolumeName','FileSystem','Size','FreeSpace','DriveType') 'root/cimv2' 'DriveType=3' }
    Read-Section 'disks' { Read-Cim 'MSFT_PhysicalDisk' @('DeviceId','FriendlyName','MediaType','BusType','Size','HealthStatus','OperationalStatus') 'root/Microsoft/Windows/Storage' }
    # Read only. No Reset method, scan, filesystem walk or SMART self-test is invoked.
    Read-Section 'reliability' { Read-Cim 'MSFT_StorageReliabilityCounter' @('DeviceId','Temperature','TemperatureMax','Wear','PowerOnHours','ReadErrorsUncorrected','WriteErrorsUncorrected') 'root/Microsoft/Windows/Storage' }
  }
  'battery' {
    Read-Section 'batteries' { Read-Cim 'Win32_Battery' @('Name','EstimatedChargeRemaining','BatteryStatus','Status') }
    Read-Section 'batteryStatic' { Read-Cim 'BatteryStaticData' @('InstanceName','Tag','DesignedCapacity','Capabilities') 'root/wmi' }
    Read-Section 'batteryFull' { Read-Cim 'BatteryFullChargedCapacity' @('InstanceName','Tag','FullChargedCapacity') 'root/wmi' }
    Read-Section 'batteryCycles' { Read-Cim 'BatteryCycleCount' @('InstanceName','Tag','CycleCount') 'root/wmi' }
  }
  'network' {
    Read-Section 'network' { Read-Cim 'Win32_NetworkAdapter' @('Name','NetConnectionID','NetConnectionStatus','Speed','NetEnabled','ConfigManagerErrorCode') 'root/cimv2' 'PhysicalAdapter=True' }
  }
  'ports' {
    # Device IDs are used only by this provider filter; serial-bearing IDs are never emitted.
    Read-Section 'ports' { Read-Cim 'Win32_PnPEntity' @('Name','PNPClass','Manufacturer','Present','ConfigManagerErrorCode','Status') 'root/cimv2' "PNPClass='USB' OR PNPClass='USBDevice' OR DeviceID LIKE 'USB%' OR ConfigManagerErrorCode<>0" }
  }
  'cooling' {
    # Firmware thermal zones are not labelled CPU/GPU temperatures.
    Read-Section 'thermal' { Read-Cim 'MSAcpi_ThermalZoneTemperature' @('CurrentTemperature','CriticalTripPoint','PassiveTripPoint') 'root/wmi' }
    Read-Section 'fans' { Read-Cim 'Win32_Fan' @('Name','Status','DesiredSpeed','VariableSpeed') }
  }
  'os' {
    Read-Section 'os' { Read-Cim 'Win32_OperatingSystem' @('Caption','Version','BuildNumber','OSArchitecture') }
    Read-Section 'computer' { Read-Cim 'Win32_ComputerSystem' @('Manufacturer','Model','SystemType') }
  }
}