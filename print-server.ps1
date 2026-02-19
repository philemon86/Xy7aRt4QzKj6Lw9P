$ErrorActionPreference = "Stop"

$port = 18080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "Print server running on http://localhost:$port/print"

function Read-Body($request) {
  $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
  $body = $reader.ReadToEnd()
  $reader.Close()
  return $body
}

while ($true) {
  $context = $listener.GetContext()
  $req = $context.Request
  $res = $context.Response

  try {
    # CORS
    $res.Headers.Add("Access-Control-Allow-Origin", "*")
    $res.Headers.Add("Access-Control-Allow-Methods", "POST, OPTIONS")
    $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

    if ($req.HttpMethod -eq "OPTIONS") {
      $res.StatusCode = 204
      $res.Close()
      continue
    }

    if ($req.HttpMethod -ne "POST" -or $req.Url.AbsolutePath -ne "/print") {
      $res.StatusCode = 404
      $res.Close()
      continue
    }

    $body = Read-Body $req
    $data = $body | ConvertFrom-Json
    $text = $data.text

    if ([string]::IsNullOrWhiteSpace($text)) {
      $res.StatusCode = 400
      $res.Close()
      continue
    }

    # Write raw text to USB001
    $bytes = [System.Text.Encoding]::GetEncoding("big5").GetBytes($text)
    [System.IO.File]::WriteAllBytes("\\.\USB001", $bytes)

    $res.StatusCode = 200
    $res.Close()
  } catch {
    $res.StatusCode = 500
    $res.Close()
  }
}
