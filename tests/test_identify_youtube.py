import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from identify_match import classify_youtube


def song(title='九尾', artist='9Lana', seconds=241, **extra):
    return dict(title=title, artists=[{'name':artist}], duration_seconds=seconds,
                videoId='example', resultType='song', videoType='MUSIC_VIDEO_TYPE_ATV', **extra)


class YouTubeTests(unittest.TestCase):
    def test_combined_video_title_can_restore_artist_automatically(self):
        for title in ['【MV】 九尾 9Lana', '9Lana - 九尾']:
            result=classify_youtube([song()], title, '', 242)
            self.assertEqual(result['status'],'matched')
            self.assertEqual(result['match']['title'],'九尾')
            self.assertEqual(result['match']['artist'],'9Lana')

    def test_known_artist_and_clean_title_match(self):
        self.assertEqual(classify_youtube([song()], '九尾 [Official Video]', '9Lana - Topic',241)['status'],'matched')

    def test_first_result_wrong_duration_or_version_is_not_used(self):
        for row in [song(seconds=300),song(title='九尾 (Live)'),song(title='九尾 Remix'),song(artist='Cover artist')]:
            self.assertEqual(classify_youtube([row], '九尾 9Lana','',241)['status'],'review')
        right=song()
        result=classify_youtube([song(title='Unrelated'),right], '九尾 9Lana','',241)
        self.assertEqual(result['match']['title'],'九尾')

    def test_channel_names_are_never_used_as_artist(self):
        row=song(); row.pop('artists');row['author']='9Lana'
        self.assertEqual(classify_youtube([row],'九尾 9Lana','',241)['status'],'unmatched')

    def test_unknown_artist_title_alone_stays_a_proposal(self):
        self.assertEqual(classify_youtube([song()], '九尾','',241)['status'],'review')

    def test_missing_duration_and_unverified_video_stay_proposals(self):
        for seconds in [None,0,'invalid',float('nan'),float('inf')]:
            self.assertEqual(classify_youtube([song(seconds=seconds)],'九尾 9Lana','',241)['status'],'review')
        row=song();row['videoType']='MUSIC_VIDEO_TYPE_OMV'
        self.assertEqual(classify_youtube([row],'九尾 9Lana','',241)['status'],'review')

    def test_duplicate_results_do_not_hide_a_valid_duration(self):
        result=classify_youtube([song(seconds=400),song()], '九尾 9Lana','',241)
        self.assertEqual(result['status'],'matched')
        self.assertEqual(result['match']['duration'],241)

    def test_two_valid_splits_are_ambiguous(self):
        result=classify_youtube([song('B C','A'),song('C','A B')],'A B C','',241)
        self.assertEqual(result['status'],'review')

