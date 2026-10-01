import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from identify_match import classify, classify_audio, clean_title, clean_artist, search_queries


def recording(title='Song', artist='Artist', duration=200000):
    return {'id':'recording-id', 'title':title, 'artist-credit':[{'name':artist}], 'length':duration}


class MatchTests(unittest.TestCase):
    def test_upload_labels_removed_without_losing_versions(self):
        self.assertEqual(clean_title('【MV】 九尾 9Lana'), '九尾 9Lana')
        self.assertEqual(clean_title('Song (Live) [Official Video]'), 'Song (Live)')
        self.assertEqual(clean_title('Song 【Remix】'), 'Song 【Remix】')
        self.assertEqual(clean_artist('Shiro Sagisu - Topic'), 'Shiro Sagisu')
        self.assertEqual(clean_artist('AC-DC'), 'AC-DC')

    def test_combined_upload_title_searches_both_fields_but_does_not_guess(self):
        queries=search_queries(clean_title('【MV】 九尾 9Lana'), '')
        self.assertEqual(len(queries), 2)
        self.assertIn('artist:"9Lana"', queries[1])
        self.assertIn('recording:"九尾"', queries[1])
        result=classify([recording('九尾','9Lana',241557)], '九尾 9Lana', '', 241)
        self.assertEqual(result['status'], 'review')
        self.assertEqual(result['candidates'][0]['artist'], '9Lana')

    def test_audio_requires_high_score_duration_and_no_close_competitor(self):
        hit=lambda score,title:{'score':score,'recordings':[{'id':title,'title':title,'artists':[{'name':'Artist'}],'duration':200}]}
        self.assertEqual(classify_audio([hit(.98,'Song')],200)['status'],'matched')
        self.assertEqual(classify_audio([hit(.80,'Song')],200)['status'],'review')
        self.assertEqual(classify_audio([hit(.98,'Song'),hit(.94,'Song live')],200)['status'],'review')
        self.assertEqual(classify_audio([hit(.98,'Song')],240)['status'],'review')

    def test_exact_title_artist_duration(self):
        self.assertEqual(classify([recording()], 'Song', 'Artist', 201)['status'], 'matched')

    def test_missing_artist_never_guessed(self):
        result=classify([recording()], 'Song', '', 200)
        self.assertEqual(result['status'], 'review')
        self.assertIsNone(result['match'])

    def test_live_remix_and_wrong_duration_stay_suggestions(self):
        for title, duration in [('Song (Live)',200),('Song (Remix)',200),('Song',230),('Song',0)]:
            self.assertEqual(classify([recording()],title,'Artist',duration)['status'],'review')

    def test_no_results_or_missing_artist(self):
        self.assertEqual(classify([], 'Song', '', 200)['status'],'unmatched')
        self.assertEqual(classify([recording(artist='')], 'Song', '', 200)['status'],'unmatched')

    def test_case_and_unicode_preserved_in_output(self):
        result=classify([recording('曲','歌手')], '曲','歌手',200)
        self.assertEqual(result['match']['title'],'曲')
        self.assertEqual(classify([recording()], 'SONG','ARTIST',200)['status'],'matched')

if __name__ == '__main__': unittest.main()
