import importlib.util,json,tempfile,types,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('guard',Path(__file__).resolve().parents[1]/'desktop/bi-filter-guard.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
class GuardTests(unittest.TestCase):
 def job(self):return {'query':{'start':'2026-10-01','end':'2026-10-02'},'config':{'exportFilters':g.normalize({'SN':{'mode':'include','values':['0012']}})}}
 def proof(self):return {'filterProof':{'version':1,'dates':{'start':'2026-10-01','end':'2026-10-02','status':'verified'},'fields':[{'field':'SN','mode':'include','requested':['0012'],'selected':['0012'],'status':'verified','complete':True}]}}
 def test_exact_values_and_invalid_modes(self):
  self.assertEqual(g.normalize({'SN':{'mode':'include','values':['0012','12']}})['SN']['values'],['0012','12'])
  for x in [{'SN':{'mode':'include','values':[]}},{'SN':{'mode':'all','values':['0012']}},{'unknown':{'mode':'keep','values':[]}}]:
   with self.assertRaises(ValueError):g.normalize(x)
 def test_marker_needs_complete_matching_readback(self):
  g.check_proof(self.job(),self.proof())
  for key,value in [('selected',['12']),('complete',False),('status','partial')]:
   p=self.proof();p['filterProof']['fields'][0][key]=value
   with self.assertRaises(ValueError):g.check_proof(self.job(),p)
 def test_date_mismatch_duplicate_or_missing_proof_stops(self):
  for p in [{},self.proof(),self.proof()]:
   if p:
    if len(p['filterProof']['fields'])==1:p['filterProof']['dates']['start']='2026-10-03'
   with self.assertRaises(ValueError):g.check_proof(self.job(),p)
  p=self.proof();p['filterProof']['fields']*=2
  with self.assertRaises(ValueError):g.check_proof(self.job(),p)
 def test_old_tasks_stay_compatible(self):g.check_proof({'config':{}},{})
 def test_all_requires_positive_all_control_evidence(self):
  job=self.job();job['config']['exportFilters']['SN']={'mode':'all','values':[]};p=self.proof();r=p['filterProof']['fields'][0];r.update(mode='all',requested=[])
  with self.assertRaises(ValueError):g.check_proof(job,p)
  r['allVerified']=True;g.check_proof(job,p)

 def test_download_filter_columns_missing_or_mismatched_never_ingest(self):
  bridge=types.SimpleNamespace(start=lambda *x:None,_poll=lambda *x:None,validate_download=lambda *x:None)
  g.install(bridge);job=self.job()
  for rows in [[{'raw':{}}],[{'raw':{'Serial Number':'12'}}]]:
   with self.assertRaises(ValueError):bridge.validate_download(job,rows,'')
  bridge.validate_download(job,[{'raw':{'Serial Number':'0012'}}],'')

if __name__=='__main__':unittest.main()
