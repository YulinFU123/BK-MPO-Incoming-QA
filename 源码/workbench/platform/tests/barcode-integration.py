"""Independent Code128 pattern decoding and package export checks, synthetic only."""
from pathlib import Path
import base64,io,json,os,subprocess,unittest
from PIL import Image
from reportlab.graphics.barcode import code128
import openpyxl

def pattern(text):
    return ''.join(('1' if ch.isupper() else '0')*(ord(ch.upper())-64) for ch in text)

def decode(bits):
    assert bits.startswith('0'*10) and bits.endswith('0'*10)
    raw=bits[10:-10];assert raw[-13:]==pattern(code128._patterns[106]);raw=raw[:-13]
    table={pattern(p):i for i,p in code128._patterns.items() if i!=106}
    symbols=[table[raw[i:i+11]] for i in range(0,len(raw),11)]
    assert symbols[-1]==(symbols[0]+sum(i*n for i,n in enumerate(symbols[1:-1],1)))%103
    mode='B' if symbols[0]==104 else 'C';out=''
    for symbol in symbols[1:-1]:
        if mode=='B' and symbol==99:mode='C'
        elif mode=='C' and symbol==100:mode='B'
        else:out+=f'{symbol:02d}' if mode=='C' else chr(symbol+32)
    return out

class BarcodeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node=os.environ.get('PLATFORM_NODE',r'C:\Users\yulinf\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
        script="""const C=require('./domain/code128'),L=require('./domain/label-layout'),R=require('./desktop/label-render'),P=require('./desktop/label-assets'),W=require('./desktop/label-workbook');
        const samples=['0012','123456','MZ2643071P3.3FWL','AB-0012/xy','A12345678Z','<&0123>','ASCII 32~126'];
        const t={version:2,width:62,height:40,elements:[{id:'qr',type:'qr',x:2,y:2,width:20,height:20},{id:'barcode',type:'barcode',x:2,y:26,width:58,height:8}]};
        const p=L.plan({...L.preset('fixture'),width:62,height:40,composition:'custom',template:t},[{code:'0012',name:'合成测试'}]);
        process.stdout.write(JSON.stringify({samples:samples.map(code=>({code,...C.encode(code),png:P.barcodePng(code,8).toString('base64')})),xlsx:W.exportWorkbook(p).toString('base64'),svg:R.labelSvg(p,0)}));"""
        result=subprocess.run([node,'-e',script],cwd=Path(__file__).parents[1],capture_output=True,encoding='utf-8',check=True);cls.data=json.loads(result.stdout)
    def test_symbols_decode_independently_through_reportlab_patterns(self):
        for sample in self.data['samples']:self.assertEqual(decode(sample['bits']),sample['code'])
    def test_png_pixel_row_decodes_and_includes_undisturbed_quiet_zones(self):
        for sample in self.data['samples']:
            image=Image.open(io.BytesIO(base64.b64decode(sample['png']))).convert('RGB');y=image.height//2
            bits=''.join('1' if image.getpixel((x*3+1,y))==(0,0,0) else '0' for x in range(image.width//3))
            self.assertEqual(decode(bits),sample['code']);self.assertTrue(all(image.getpixel((x,y))==(255,255,255) for x in list(range(30))+list(range(image.width-30,image.width))))
    def test_actual_excel_contains_both_images_and_barcode_pixels_round_trip(self):
        book=openpyxl.load_workbook(io.BytesIO(base64.b64decode(self.data['xlsx'])));sheet=book['标签1'];self.assertEqual(len(sheet._images),2)
        barcode=next(i for i in sheet._images if i.width>i.height);image=Image.open(io.BytesIO(barcode._data())).convert('RGB');bits=''.join('1' if image.getpixel((x*3+1,image.height//2))==(0,0,0) else '0' for x in range(image.width//3));self.assertEqual(decode(bits),'0012');self.assertEqual(book['编号清单']['A2'].value,'0012');book.close()

if __name__=='__main__':unittest.main()
