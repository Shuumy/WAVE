"""API orchestration regressions; CI installs FastAPI before running these."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
try:
    from identify import search, HTTPException
except ModuleNotFoundError as exc:
    raise unittest.SkipTest('API dependencies unavailable: ' + str(exc))


class SearchTests(unittest.TestCase):
    def test_video_example_finds_suggestion_after_empty_exact_lookup(self):
        row={'id':'example','title':'九尾','artist-credit':[{'name':'9Lana'}],'length':241557}
        with patch('identify.request_json', side_effect=[{'recordings':[]},{'recordings':[row]}]) as fetch:
            result=search('【MV】 九尾 9Lana','',241)
        self.assertEqual(result['status'],'review')
        self.assertEqual(result['candidates'][0]['title'],'九尾')
        queries=[parse_qs(urlparse(c.args[0]).query)['query'][0] for c in fetch.call_args_list]
        self.assertNotIn('MV',queries[0])
        self.assertIn('artist:"9Lana"',queries[1])

    def test_topic_suffix_allows_exact_match_without_fallback(self):
        row={'id':'example','title':'Song','artist-credit':[{'name':'Artist'}],'length':200000}
        with patch('identify.request_json',return_value={'recordings':[row]}) as fetch:
            result=search('Song [Official Video]','Artist - Topic',200)
        self.assertEqual(result['status'],'matched')
        self.assertEqual(fetch.call_count,1)

    def test_fallback_failure_does_not_discard_existing_suggestion(self):
        row={'title':'Song','artist-credit':[{'name':'Artist'}],'length':200000}
        with patch('identify.request_json',side_effect=[{'recordings':[row]},HTTPException(503)]):
            self.assertEqual(search('Song','',200)['status'],'review')

