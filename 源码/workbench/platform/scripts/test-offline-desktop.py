"""Run isolated backend/DOM regressions using only a built Windows offline package.
No app window, browser, company data, network download or original data is used.
"""
from pathlib import Path
import argparse,json,os,re,subprocess,sys

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--program-root',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    program=Path(args.program_root).resolve(strict=True);source=program/'resources/app/platform';python=program/'resources/app/python/python.exe';exe=program/'异常分析平台.exe';output=Path(args.output).resolve()
    if output.exists():raise ValueError('自检输出目录已存在，请指定新的隔离目录，不覆盖旧证据。')
    if not all(p.is_file() for p in [python,exe,source/'desktop/lab_worker.py']):raise ValueError('离线包不完整。')
    output.mkdir(parents=True);data=output/'data';data.mkdir()
    env=dict(os.environ,ELECTRON_RUN_AS_NODE='1',LEGACY_SOURCE_ROOT=str(program/'resources/app/legacy'),PLATFORM_PYTHON=str(python),PLATFORM_NODE=str(exe),PLATFORM_TEST_ROOT=str(data),PLATFORM_QA_ROOT=str(data),PLATFORM_STORAGE_DIAGNOSTICS=str(data/'rename-diagnostics'))
    def run(command,log):
        with (output/log).open('x',encoding='utf-8') as stream:
            result=subprocess.run(list(map(str,command)),cwd=source,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=240,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        return result.returncode,(output/log).read_text(encoding='utf-8')
    code,result=run([exe,'--require','./scripts/storage-diagnostics.cjs','--test','--test-reporter=tap'],'Node完整回归.txt')
    count=int(re.search(r'^# tests (\d+)$',result,re.M)[1]);passed=int(re.search(r'^# pass (\d+)$',result,re.M)[1]);failed=int(re.search(r'^# fail (\d+)$',result,re.M)[1]);skipped=int(re.search(r'^# skipped (\d+)$',result,re.M)[1])
    groups={};python_failures=[]
    for name in ['bi-home-integration','defect-export-integration','bi-inbox-integration','analysis-studio-integration','analysis-report-integration','barcode-integration']:
        result_code,result=run([python,'-I','-B',source/'tests'/(name+'.py')],name+'.txt');groups[name]=int(re.search(r'Ran (\d+) tests',result)[1])
        if result_code or '\nOK' not in result:python_failures.append(name)
    report={'node':count,'nodePassed':passed,'nodeFailed':failed,'python':sum(groups.values()),'pythonFailedGroups':python_failures,'groups':groups,'failed':failed+len(python_failures),'skipped':skipped,'onlyBundledRuntimes':True,'visibleUiTested':False,'companyFilesTested':False,'formalReleaseApproved':False}
    (output/'结果.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report))
    return 1 if code or report['failed'] or skipped else 0

if __name__=='__main__':sys.exit(main())
