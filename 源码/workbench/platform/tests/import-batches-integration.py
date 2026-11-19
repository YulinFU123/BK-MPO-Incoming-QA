"""Import correction in disposable SQLite workspaces, never in business data."""

import csv
import hashlib
import json
import os
import sqlite3
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from lab_engine import exports, service, store, tabular


class ImportBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / 'source'
        self.folder.mkdir()
        self.db = store.connect(self.root / 'db')
        self.addCleanup(self.db.close)
        self.path = self.folder / 'revised.csv'
        self.write([['2026-11-01', '001', 1], ['2026-11-02', '002', 2]])
        source = dict(id='defects', name='合成来源', kind='defects', folder=str(self.folder), sheet='',
                      headerRow=0, cutoff=0, dateFormat='ymd', unit='units', coverage='rows',
                      dateFromFilename=False, uniqueColumns=[], updateMode='replace_dates')
        inspection = tabular.inspect(self.path, source)
        source.update(mapping=inspection['mapping'], columns=inspection['columns'],
                      schema=inspection['schema'], confirmed=True)
        self.source = source

    def write(self, rows):
        with self.path.open('w', encoding='utf-8-sig', newline='') as file:
            csv.writer(file).writerows([['日期', 'SN', '数量'], *rows])

    def imported(self):
        result = store.import_files(self.db, self.source, [self.path.name])
        self.assertEqual(result['errors'], 0, result)
        self.assertGreater(result['importedRows'], 0)
        return store.import_history(self.db, self.source)['batches'][0]['batchId']

    def quantities(self):
        return sorted(row['quantity'] for row in store.load_rows(self.db, self.source))

    def change(self, batch, enabled):
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        result = service.handle(self.db, {
            'action': 'setImportBatch', 'config': {'sources': [self.source]},
            'sourceId': self.source['id'], 'batchId': batch,
            'enabled': enabled, 'revision': store.revision(self.db),
        })
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)
        return result

    def test_revised_dates_are_exactly_restored_and_reapplied(self):
        first = self.imported()
        self.write([['2026-11-01', '001', 9]])
        second = self.imported()
        self.assertEqual(self.quantities(), [2, 9])
        before = store.revision(self.db)
        self.change(second, False)
        self.assertEqual(store.revision(self.db), before + 1)
        self.assertEqual(self.quantities(), [1, 2])
        self.change(second, True)
        self.assertEqual(self.quantities(), [2, 9])
        self.assertEqual(store.import_history(self.db, self.source)['batches'][1]['batchId'], first)
        self.assertFalse(self.change(second, True)['changed'])

    def test_withdrawing_replacement_never_revives_an_explicitly_withdrawn_older_batch(self):
        first = self.imported()
        self.write([['2026-11-01', '001', 9]])
        second = self.imported()
        self.change(first, False)
        self.assertEqual(self.quantities(), [9])
        self.change(second, False)
        self.assertEqual(self.quantities(), [])
        self.change(second, True)
        self.assertEqual(self.quantities(), [9])
        self.change(first, True)
        self.assertEqual(self.quantities(), [2, 9])

    def test_future_revision_covers_records_which_were_temporarily_withdrawn(self):
        first = self.imported()
        self.change(first, False)
        self.write([['2026-11-01', '001', 7]])
        second = self.imported()
        self.change(first, True)
        self.assertEqual(self.quantities(), [2, 7])
        self.change(second, False)
        self.assertEqual(self.quantities(), [1, 2])

    def test_append_mode_preserves_independent_rows(self):
        self.source['updateMode'] = 'append'
        self.imported()
        self.write([['2026-11-01', '003', 9]])
        added = self.imported()
        self.assertEqual(self.quantities(), [1, 2, 9])
        self.change(added, False)
        self.assertEqual(self.quantities(), [1, 2])
        self.change(added, True)
        self.assertEqual(self.quantities(), [1, 2, 9])

    def test_automatic_or_manual_rescan_cannot_silently_reimport_withdrawn_bytes(self):
        batch = self.imported()
        self.change(batch, False)
        result = store.import_files(self.db, self.source)
        self.assertEqual(result['importedRows'], 0)
        self.assertEqual(result['files'][0]['status'], '已撤销批次')
        self.assertEqual(self.quantities(), [])
        self.change(batch, True)
        self.assertEqual(self.quantities(), [1, 2])

    def test_history_row_counts_follow_cross_file_deduplication(self):
        self.imported()
        old_path = self.path
        self.path = self.folder / 'additional.csv'
        self.write([['2026-11-01', '001', 1], ['2026-11-03', '003', 3]])
        newest = self.imported()
        batches = store.import_history(self.db, self.source)['batches']
        self.assertEqual([batch['visibleRows'] for batch in batches], [2, 1])
        self.assertEqual(sum(batch['visibleRows'] for batch in batches), len(store.load_rows(self.db, self.source)))
        self.change(newest, False)
        self.assertEqual(self.quantities(), [1, 2])
        self.assertTrue(old_path.is_file())

    def test_legacy_masks_are_preserved_without_guessing_covered_history(self):
        self.imported()
        self.write([['2026-11-01', '001', 9]])
        self.imported()
        with self.db:
            self.db.execute('DELETE FROM import_record_covers')
            self.db.execute('DELETE FROM import_record_baseline')
            self.db.execute('DELETE FROM import_batches')
        legacy = store.import_history(self.db, self.source)['batches'][0]
        self.assertTrue(legacy['legacy'])
        self.change(legacy['batchId'], False)
        self.assertEqual(self.quantities(), [2])
        self.change(legacy['batchId'], True)
        self.assertEqual(self.quantities(), [2, 9])

    def test_foreign_source_and_stale_revisions_are_rejected_atomically(self):
        batch = self.imported()
        old_revision = store.revision(self.db)
        other = {**self.source, 'id': 'other'}
        with self.assertRaisesRegex(ValueError, '不属于'):
            store.set_import_batch(self.db, other, batch, False, old_revision)
        with self.assertRaisesRegex(ValueError, '已变化'):
            store.set_import_batch(self.db, self.source, batch, False, old_revision - 1)
        with self.assertRaisesRegex(ValueError, '参数'):
            store.set_import_batch(self.db, self.source, str(self.path), False, old_revision)
        self.assertEqual(self.quantities(), [1, 2])
        self.assertEqual(store.revision(self.db), old_revision)
        self.source['cutoff'] = 7
        with self.assertRaisesRegex(ValueError, '映射'):
            store.set_import_batch(self.db, self.source, batch, False, old_revision)

    def test_untracked_masks_from_an_older_compatible_runtime_are_not_revived(self):
        batch = self.imported()
        with self.db:
            self.db.execute('UPDATE records SET active=0')
            self.db.execute("UPDATE meta SET value=value+1 WHERE key='revision'")
        store.import_history(self.db, self.source)
        self.change(batch, False)
        self.change(batch, True)
        self.assertEqual(self.quantities(), [])

    def test_failure_during_mask_rebuild_rolls_back_batch_state_and_revision(self):
        batch = self.imported()
        previous = store.revision(self.db)
        self.db.execute("""CREATE TRIGGER injected_failure BEFORE UPDATE OF active ON records
                           BEGIN SELECT RAISE(ABORT, 'injected mask failure'); END""")
        with self.assertRaisesRegex(sqlite3.IntegrityError, 'injected mask failure'):
            store.set_import_batch(self.db, self.source, batch, False, previous)
        self.assertEqual(store.revision(self.db), previous)
        self.assertFalse(store.import_history(self.db, self.source)['batches'][0]['withdrawn'])
        self.assertEqual(self.quantities(), [1, 2])

    def test_backup_restore_keeps_withdrawn_batches_and_supports_old_four_table_backup(self):
        batch = self.imported()
        self.change(batch, False)
        config = {'sources': [self.source], 'report': {'charts': []}}
        backup = self.root / 'history.labpack'
        exports.backup(self.db, {'config': config, 'output': str(backup)})
        restored = store.connect(self.root / 'restore')
        self.addCleanup(restored.close)
        approved = exports.inspectBackup(restored, {'input': str(backup)})['config']
        exports.restore(restored, {'input': str(backup), 'approvedConfig': json.dumps(approved)})
        self.assertEqual(store.load_rows(restored, self.source), [])
        store.set_import_batch(restored, self.source, batch, True, store.revision(restored))
        self.assertEqual(len(store.load_rows(restored, self.source)), 2)
        # Existing backup structure remains accepted by the same normal restore path.
        with restored:
            for name in ('import_record_covers', 'import_record_baseline', 'import_batches'):
                restored.execute('DROP TABLE ' + name)
        old_backup = self.root / 'legacy.labpack'
        exports.backup(restored, {'config': config, 'output': str(old_backup)})
        target = store.connect(self.root / 'legacy-restore')
        self.addCleanup(target.close)
        approved = exports.inspectBackup(target, {'input': str(old_backup)})['config']
        exports.restore(target, {'input': str(old_backup), 'approvedConfig': json.dumps(approved)})
        self.assertEqual(len(store.load_rows(target, self.source)), 2)
        self.assertEqual(len(store.import_history(target, self.source)['batches']), 1)


if __name__ == '__main__':
    unittest.main()
