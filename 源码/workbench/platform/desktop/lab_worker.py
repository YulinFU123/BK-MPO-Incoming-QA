"""Native stdin/stdout worker; no HTTP port or browser access."""
from pathlib import Path
import argparse, json, sys
sys.stdin.reconfigure(encoding='utf-8'); sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,str(Path(__file__).resolve().parent))
from lab_engine import service, store

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--data',required=True); parser.add_argument('--source')
    args=parser.parse_args(); db=store.connect(args.data)
    print(json.dumps({'ready':True}),flush=True)
    for line in sys.stdin:
        request={}
        try:
            request=json.loads(line)
            if request.get('control')=='close':
                print(json.dumps({'id':request.get('id'),'ok':True,'value':True}),flush=True); break
            value=service.handle(db,request.get('body',{}))
            print(json.dumps({'id':request.get('id'),'ok':True,'value':value},ensure_ascii=False,allow_nan=False),flush=True)
        except Exception as error:
            print(json.dumps({'id':request.get('id'),'ok':False,'error':str(error)},ensure_ascii=False),flush=True)
    db.close()
if __name__=='__main__': main()
