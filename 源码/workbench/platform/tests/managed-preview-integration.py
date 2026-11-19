"""Native read-only workspace projection; synthetic SQLite only."""
from pathlib import Path
import hashlib
import importlib.util
import sqlite3
import unittest

spec=importlib.util.spec_from_file_location('fixture',Path(__file__).with_name('analysis-studio-integration.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
from lab_engine import store
import lab_preview_worker as preview

class PreviewTests(unittest.TestCase):
    setUp=fixture.StudioTests.setUp
    tearDown=fixture.StudioTests.tearDown
    workbook=fixture.StudioTests.workbook
    source=fixture.StudioTests.source
    fixture=fixture.StudioTests.fixture

    def payload(self):
        self.db.close();self.directory=self.root/'managed';self.identity='ws_00000000-0000-0000-0000-000000000001'
        self.db=store.connect(self.directory/(self.identity+'.eap.analysis-data'))
        source,_,_=self.fixture();self.source_config=source
        return {'action':'home','workspaceId':self.identity,'config':{'sources':[source],'activeSource':source['id']},
                'calendar':{'version':1,'sources':{}},'query':{'start':'2026-09-19','end':'2026-09-20','grain':'day','filters':{}},'preference':{}}

    def test_preview_uses_only_the_requested_workspace_and_leaves_database_content_unchanged(self):
        body=self.payload();file=self.directory/(self.identity+'.eap.analysis-data')/'analysis-v1.sqlite'
        self.db.execute('PRAGMA wal_checkpoint(FULL)')
        before=hashlib.sha256(file.read_bytes()).hexdigest()
        result=preview.read(self.directory,body)
        self.assertEqual((result['rowCount'],result['quantity']),(2,5))
        self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),before)
        absent={**body,'workspaceId':'ws_00000000-0000-0000-0000-000000000002'}
        self.assertEqual(preview.read(self.directory,absent)['state'],'empty')
        self.assertFalse((self.directory/(absent['workspaceId']+'.eap.analysis-data')).exists())

    def test_mutations_and_path_traversal_are_rejected(self):
        body=self.payload()
        for action in ['import','restore','rollbackRestore','export']:
            with self.assertRaises(ValueError):preview.read(self.directory,{**body,'action':action})
        with self.assertRaises(ValueError):preview.read(self.directory,{**body,'workspaceId':'../outside'})

    def test_configuration_missing_is_not_reported_as_empty_manual_data(self):
        body=self.payload();body['config']={'sources':[]}
        result=preview.read(self.directory,body)
        self.assertEqual(result['state'],'unconfigured');self.assertTrue(result['hasData'])

    def test_production_only_does_not_masquerade_as_defect_data(self):
        body=self.payload()
        with self.db:
            self.db.execute("DELETE FROM records WHERE source_id='defects'")
            self.db.execute("DELETE FROM files WHERE source_id='defects'")
        production=self.source(self.prod,'production')
        body['config']={'sources':[production],'activeSource':production['id']}
        result=preview.read(self.directory,body)
        self.assertEqual(result['state'],'empty')
        self.assertFalse(result.get('hasData',False))

    def test_new_read_sees_external_changes_and_does_not_reuse_an_old_snapshot(self):
        body=self.payload();self.assertEqual(preview.read(self.directory,body)['quantity'],5)
        with self.db:
            self.db.execute("UPDATE records SET quantity=quantity+1,canonical_json=json_set(canonical_json,'$.quantity',quantity+1) WHERE source_id=?",(self.source_config['id'],))
        self.assertEqual(preview.read(self.directory,body)['quantity'],7)

if __name__=='__main__':unittest.main()
