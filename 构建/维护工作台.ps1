param([ValidateSet('Info','Test')][string]$Action='Info')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$index=Get-Content -LiteralPath (Join-Path $projectRoot '成果\版本索引.json') -Raw -Encoding UTF8|ConvertFrom-Json
$source=Join-Path $projectRoot $index.source
$version=(Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json).version
if($version -ne $index.current.version){throw '活动源码与当前版本索引不一致，请核对后再维护。'}
$program=Join-Path $projectRoot $index.current.program
$prior=Join-Path $projectRoot $index.previous.program
if(-not(Test-Path -LiteralPath $program) -or -not(Test-Path -LiteralPath $prior)){throw '当前或上一版程序缺失。'}
if($Action -eq 'Info'){
    [ordered]@{Current=$index.current.version;Previous=$index.previous.version;Source=$source;SourceVersion=$version;CurrentProgram=$program;PreviousProgram=$prior;FormalReleaseApproved=$index.current.formalReleaseApproved;KnownIssues=$index.knownIssues}|ConvertTo-Json
    return
}
$qa=Join-Path $PSScriptRoot '当前作业\目录与版本整理\验证\内核回归'
New-Item -ItemType Directory -Path $qa -Force|Out-Null
$saved=@{}
foreach($key in @('ELECTRON_RUN_AS_NODE','PLATFORM_PYTHON','PLATFORM_TEST_ROOT','PLATFORM_QA_ROOT')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
try{
    $env:ELECTRON_RUN_AS_NODE='1'
    $env:PLATFORM_PYTHON=Join-Path ([IO.Path]::GetDirectoryName($program)) 'resources\app\python\python.exe'
    $env:PLATFORM_TEST_ROOT=$qa
    $env:PLATFORM_QA_ROOT=$qa
    foreach($arguments in @('--test --test-reporter=tap','scripts/check-boundaries.js')){
        $start=[Diagnostics.ProcessStartInfo]::new()
        $start.FileName=$program;$start.Arguments=$arguments;$start.WorkingDirectory=Join-Path ([IO.Path]::GetDirectoryName($program)) 'resources\app\platform'
        $start.UseShellExecute=$false;$start.CreateNoWindow=$true
        $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
        $start.StandardOutputEncoding=[Text.Encoding]::UTF8;$start.StandardErrorEncoding=[Text.Encoding]::UTF8
        $process=[Diagnostics.Process]::new();$process.StartInfo=$start
        try{
            [void]$process.Start()
            $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
            if(-not $process.WaitForExit(300000)){$process.Kill();throw '检查超时。'}
            $out=$stdout.GetAwaiter().GetResult();$err=$stderr.GetAwaiter().GetResult()
            $out|Write-Output;if($err){$err|Write-Output}
            if($process.ExitCode -ne 0){throw ('检查失败，退出码 '+$process.ExitCode+'；不得据此放行正式版。')}
        }finally{$process.Dispose()}
    }
}finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
