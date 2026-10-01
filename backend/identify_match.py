"""Pure match policy, tested without network or API credentials."""
import re
import unicodedata


def clean_title(value):
    # Remove only explicit upload labels, never performance/version qualifiers.
    value = re.sub(r'[\[（(【](?:official\s*(?:music\s*)?(?:video|audio)|original\s+anime\s+mv|mv|pv|lyrics?|visuali[sz]er|\d{3,4}p)[\]）)】]', ' ', value, flags=re.I)
    return ' '.join(value.split())


def clean_artist(value):
    return re.sub(r'\s+[-–—]\s+Topic\s*$', '', value, flags=re.I).strip()


def search_queries(title, artist):
    def quote(value):
        return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
    exact = 'recording:' + quote(title)
    if artist:
        exact += ' AND artist:' + quote(artist)
    # Upload titles often combine title and artist in one field. Search each
    # word in either field without assuming an order or inventing a split.
    words = re.findall(r'\w+', title, flags=re.UNICODE)[:16]
    broad = ' AND '.join('(recording:' + quote(w) + ' OR artist:' + quote(w) + ')' for w in words)
    if artist and broad:
        broad += ' AND artist:' + quote(artist)
    return list(dict.fromkeys(q for q in [exact, broad] if q))


def classify_audio(hits, duration):
    scored = []
    for hit in hits:
        for row in hit.get('recordings', []):
            artist = ', '.join(a.get('name', '') for a in row.get('artists', []))
            if row.get('title') and artist:
                scored.append((float(hit.get('score', 0)), candidate(row['title'], artist, row.get('id', ''), row.get('duration', 0))))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    choices = []
    for score, item in scored:
        if item not in choices:
            choices.append(item)
    match = None
    if scored:
        score, top = scored[0]
        competing = {(normalize(c['title']), normalize(c['artist'])) for s,c in scored if s >= score - .05}
        if score >= .95 and len(competing) == 1 and top['duration'] and abs(top['duration'] - duration) <= 3:
            match = top
    return {'source':'AcoustID', 'status':'matched' if match else 'review' if choices else 'unmatched', 'match':match, 'candidates':choices[:5]}

def normalize(value):
    return ' '.join(re.sub(r'[^\w\s]', ' ', unicodedata.normalize('NFKC', value).casefold()).split())


def artist_credit(credits):
    return ''.join(c.get('name', c.get('artist', {}).get('name', '')) + c.get('joinphrase', '') for c in credits)


def candidate(title, artist, ident, duration=0):
    return {'title': str(title)[:200], 'artist': str(artist)[:200], 'recordingId': str(ident)[:50], 'duration': duration}


def classify(recordings, title, artist, duration):
    choices = []
    for row in recordings:
        name = artist_credit(row.get('artist-credit', []))
        if not row.get('title') or not name:
            continue
        c = candidate(row['title'], name, row.get('id', ''), (row.get('length') or 0) / 1000)
        if not any(normalize(x['title']) == normalize(c['title']) and normalize(x['artist']) == normalize(c['artist']) for x in choices):
            choices.append(c)
    exact = [c for c in choices if normalize(c['title']) == normalize(title)
             and artist and normalize(c['artist']) == normalize(artist)
             and duration > 0 and c['duration'] > 0 and abs(c['duration'] - duration) <= 3]
    # Text search never invents an artist for an unlabelled file.
    return {'source': 'MusicBrainz', 'status': 'matched' if len(exact) == 1 else 'review' if choices else 'unmatched',
            'match': exact[0] if len(exact) == 1 else None, 'candidates': choices[:5]}
