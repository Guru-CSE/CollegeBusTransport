$ErrorActionPreference = 'Stop'

$addresses = @(
  foreach ($adapter in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($adapter.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up -or
        $adapter.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) { continue }
    foreach ($unicast in $adapter.GetIPProperties().UnicastAddresses) {
      $ip = $unicast.Address
      if ($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
          -not [System.Net.IPAddress]::IsLoopback($ip) -and -not $ip.IPAddressToString.StartsWith('169.254.')) {
        [pscustomobject]@{ Interface = $adapter.Name; Address = $ip.IPAddressToString }
      }
    }
  }
) | Sort-Object Interface, Address -Unique

if (-not $addresses -or $addresses.Count -eq 0) {
  $currentInterface = 'Unknown adapter'
  $adapterConnected = $true
  foreach ($line in (& ipconfig)) {
    if ($line -match '^\s*(?:Wireless LAN|Ethernet|Unknown) adapter\s+(.+):\s*$') {
      $currentInterface = $matches[1].Trim()
      $adapterConnected = $true
    } elseif ($line -match 'Media State.*Media disconnected') {
      $adapterConnected = $false
    } elseif ($adapterConnected -and $line -match 'IPv4 Address[^:]*:\s*([0-9.]+)') {
      $ip = $matches[1]
      if ($ip -ne '127.0.0.1' -and -not $ip.StartsWith('169.254.')) {
        $addresses += [pscustomobject]@{ Interface = $currentInterface; Address = $ip }
      }
    }
  }
  $addresses = @($addresses | Sort-Object Interface, Address -Unique)
}

if (-not $addresses -or $addresses.Count -eq 0) {
  throw 'No active non-loopback IPv4 address was found. Connect to Wi-Fi or your phone hotspot and try again.'
}

Write-Host 'Available local IPv4 addresses:'
$addresses | Format-Table -AutoSize
$selectedAddress = Read-Host 'Enter the Wi-Fi/hotspot IPv4 address shown above (do not choose a VPN or virtual adapter)'
if ($selectedAddress -notin $addresses.Address) {
  throw 'The address must exactly match one of the active IPv4 addresses listed above.'
}

$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if (-not $mkcert) {
  throw 'mkcert was not found. Install it with winget, Chocolatey, Scoop, or an official prebuilt binary, then reopen PowerShell.'
}

$certDir = Join-Path $PSScriptRoot '..\.local-https'
New-Item -ItemType Directory -Path $certDir -Force | Out-Null
$certFile = Join-Path $certDir 'server-cert.pem'
$keyFile = Join-Path $certDir 'server-key.pem'
$hostFile = Join-Path $certDir 'host.txt'

& $mkcert.Source -install
if ($LASTEXITCODE -ne 0) { throw 'mkcert could not install its local development CA in the Windows trust store.' }
& $mkcert.Source -cert-file $certFile -key-file $keyFile 'localhost' '127.0.0.1' '::1' $selectedAddress
if ($LASTEXITCODE -ne 0) { throw 'mkcert could not generate the HTTPS certificate.' }
Set-Content -LiteralPath $hostFile -Value $selectedAddress -NoNewline -Encoding ascii

Write-Host "Certificate created for localhost and $selectedAddress."
Write-Host 'The HTTPS server will bind only to this local network address.'
Write-Host 'For phone trust, copy only rootCA.pem from the folder returned by: mkcert -CAROOT'
Write-Host 'Never copy rootCA-key.pem or server-key.pem to the phone.'
