import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from identify_match import best_result

def choose(items,title='BUMP OF CHICKEN 新世界',artist='',duration=240):
    return best_result({'status':'review','source':'YouTube Music','candidates':items},title,artist,duration)

def item(title,artist='BUMP OF CHICKEN',duration=240):
    return dict(title=title,artist=artist,duration=duration)

class BestTests(unittest.TestCase):
    def test_bilingual_studio_title_beats_live_wrong_artist_and_unrelated(self):
        result=choose([item('Souvenir'),item('新世界 (Live Tour 2023)'),item('新世界 - Shinsekai'),item('新世界LIVE','Orangestar')])
        self.assertEqual(result['match']['title'],'新世界 - Shinsekai')
        self.assertEqual(result['candidates'],[])

    def test_uncertain_artist_or_duration_produces_no_change(self):
        for title,artist,duration in [('新世界','',240),('新世界','BUMP OF CHICKEN',0),('新世界','BUMP OF CHICKEN',300)]:
            self.assertEqual(choose([item('新世界')],title,artist,duration)['status'],'unmatched')

    def test_close_distinct_titles_do_not_silently_choose_the_first(self):
        self.assertEqual(choose([item('新世界 - Shinsekai'),item('新世界 - New World')])['status'],'unmatched')

    def test_identical_candidates_and_better_duration_are_deduplicated(self):
        result=choose([item('新世界',duration=243),item('新世界',duration=240)])
        self.assertEqual(result['match']['duration'],240)

    def test_live_query_cannot_be_replaced_by_studio(self):
        self.assertEqual(choose([item('新世界')],'新世界 Live','BUMP OF CHICKEN')['status'],'unmatched')

