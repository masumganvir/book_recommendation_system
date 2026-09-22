import os
import gc
import difflib
import pickle
import numpy as np
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# ==============================================================================
# 1. Model & Data Initialization
# ==============================================================================
print("Loading model artifacts...")
popular_df = pickle.load(open('popular.pkl', 'rb'))
pt = pickle.load(open('pt.pkl', 'rb'))
books = pickle.load(open('books.pkl', 'rb'))
similarity_scores = pickle.load(open('similarity_scores.pkl', 'rb'))
print("Artifacts loaded successfully!")

# Ensure image URLs use HTTPS to prevent Mixed Content security blocking on Render
def secure_image_url(url):
    if not url or not isinstance(url, str):
        return '/static/images/book-placeholder.svg'
    return url.replace('http://', 'https://')

# Build fast in-memory lookup cache for book metadata
# This avoids scanning 270,000+ DataFrame rows on every recommendation request (O(1) lookup)
print("Building fast book metadata index...")
books_dedup = books.drop_duplicates('Book-Title').set_index('Book-Title')

book_metadata_cache = {}
for title in pt.index:
    if title in books_dedup.index:
        row = books_dedup.loc[title]
        book_metadata_cache[title] = {
            'title': str(title),
            'author': str(row.get('Book-Author', 'Unknown Author')),
            'image': secure_image_url(row.get('Image-URL-M', '')),
            'year': str(row.get('Year-Of-Publication', 'N/A')),
            'publisher': str(row.get('Publisher', 'N/A'))
        }
    else:
        book_metadata_cache[title] = {
            'title': str(title),
            'author': 'Unknown Author',
            'image': '/static/images/book-placeholder.svg',
            'year': 'N/A',
            'publisher': 'N/A'
        }

books_catalog_count = len(books_dedup)
# Free raw DataFrame memory to stay safely below Render free tier 512MB RAM cap
del books
del books_dedup
gc.collect()

# Lowercase mapping for fast case-insensitive exact matching
lower_title_map = {title.lower().strip(): title for title in pt.index}
all_titles_list = list(pt.index)

# Pre-format popular books list for the home page
popular_books_list = []
for idx, row in popular_df.reset_index(drop=True).iterrows():
    popular_books_list.append({
        'rank': idx + 1,
        'title': str(row['Book-Title']),
        'author': str(row['Book-Author']),
        'image': secure_image_url(row['Image-URL-M']),
        'votes': int(row['num_ratings']),
        'rating': round(float(row['avg_rating']), 2)
    })

print(f"Server ready! {len(popular_books_list)} popular books, {len(all_titles_list)} collaborative models.")

# ==============================================================================
# 2. Recommendation Engine Helper Function
# ==============================================================================
def find_recommendations(user_query, top_n=5):
    """
    Find top_n recommendations for a given book title with fuzzy matching,
    similarity scores, and metadata lookup.
    """
    if not user_query or not isinstance(user_query, str):
        return {
            'success': False,
            'message': 'Please provide a valid book title.',
            'suggestions': all_titles_list[:5]
        }

    clean_query = user_query.strip()
    clean_lower = clean_query.lower()

    # Step 1: Exact match
    matched_title = None
    if clean_query in pt.index:
        matched_title = clean_query
    # Step 2: Case-insensitive match
    elif clean_lower in lower_title_map:
        matched_title = lower_title_map[clean_lower]
    # Step 3: Substring search in titles
    else:
        substring_matches = [t for t in all_titles_list if clean_lower in t.lower()]
        if substring_matches:
            matched_title = substring_matches[0]
        else:
            # Step 4: Fuzzy matching with difflib
            close_matches = difflib.get_close_matches(clean_query, all_titles_list, n=4, cutoff=0.4)
            return {
                'success': False,
                'message': f"We couldn't find '{clean_query}' in our trained collaborative filtering matrix.",
                'suggestions': close_matches if close_matches else all_titles_list[:5]
            }

    # Retrieve vector index in pivot table
    try:
        index = np.where(pt.index == matched_title)[0][0]
    except Exception as e:
        return {
            'success': False,
            'message': f'Error locating index for {matched_title}: {str(e)}',
            'suggestions': all_titles_list[:5]
        }

    # Calculate top similar items excluding self (index 0 in sorted array)
    similar_indices = sorted(
        list(enumerate(similarity_scores[index])),
        key=lambda x: x[1],
        reverse=True
    )[1:top_n + 1]

    recommendations = []
    for item_idx, score in similar_indices:
        rec_title = pt.index[item_idx]
        meta = book_metadata_cache.get(rec_title, {
            'title': rec_title,
            'author': 'Unknown Author',
            'image': '/static/images/book-placeholder.svg',
            'year': 'N/A',
            'publisher': 'N/A'
        })

        # Calculate normalized similarity percentage
        sim_val = float(score)
        sim_percent = max(0, min(100, int(round(sim_val * 100))))

        recommendations.append({
            'title': meta['title'],
            'author': meta['author'],
            'image': meta['image'],
            'year': meta['year'],
            'publisher': meta['publisher'],
            'similarity_score': round(sim_val, 4),
            'similarity_percent': sim_percent
        })

    searched_meta = book_metadata_cache.get(matched_title, {
        'title': matched_title,
        'author': 'Unknown Author',
        'image': '/static/images/book-placeholder.svg',
        'year': 'N/A',
        'publisher': 'N/A'
    })

    return {
        'success': True,
        'searched_book': searched_meta,
        'recommendations': recommendations
    }

# ==============================================================================
# 3. Web & API Routes
# ==============================================================================
@app.route('/')
def index():
    """Home page rendering Top 50 Popular Books."""
    return render_template(
        'index.html',
        active_page='home',
        books=popular_books_list
    )

@app.route('/recommend', methods=['GET'])
def recommend_ui():
    """AI Recommendation Studio view."""
    book_param = request.args.get('book', '').strip()
    if book_param:
        res = find_recommendations(book_param)
        return render_template(
            'recommend.html',
            active_page='recommend',
            query_title=book_param,
            searched_book=res.get('searched_book'),
            recommendations=res.get('recommendations'),
            error_message=None if res.get('success') else res.get('message'),
            suggestions=res.get('suggestions', [])
        )

    return render_template(
        'recommend.html',
        active_page='recommend',
        query_title='',
        searched_book=None,
        recommendations=None,
        error_message=None,
        suggestions=[]
    )

@app.route('/recommend_books', methods=['GET', 'POST'])
def recommend():
    """Standard POST form submission handler (with error prevention)."""
    if request.method == 'POST':
        user_input = request.form.get('user_input', '').strip()
    else:
        user_input = request.args.get('user_input', '').strip()

    if not user_input:
        return render_template(
            'recommend.html',
            active_page='recommend',
            query_title='',
            searched_book=None,
            recommendations=None,
            error_message="Please enter a book title to receive recommendations.",
            suggestions=all_titles_list[:6]
        )

    res = find_recommendations(user_input)

    return render_template(
        'recommend.html',
        active_page='recommend',
        query_title=user_input,
        searched_book=res.get('searched_book'),
        recommendations=res.get('recommendations'),
        error_message=None if res.get('success') else res.get('message'),
        suggestions=res.get('suggestions', [])
    )

@app.route('/about')
@app.route('/contact')
def about():
    """System architecture and algorithmic walkthrough page."""
    return render_template('contact.html', active_page='about')

# ==============================================================================
# 4. RESTful JSON Endpoints for Dynamic AJAX Communication
# ==============================================================================
@app.route('/api/popular', methods=['GET'])
def api_popular():
    """JSON endpoint returning top popular books."""
    return jsonify({
        'status': 'success',
        'count': len(popular_books_list),
        'books': popular_books_list
    })

@app.route('/api/titles', methods=['GET'])
def api_titles():
    """Returns all 706 model titles for instant client-side autocomplete."""
    return jsonify(all_titles_list)

@app.route('/api/search', methods=['GET'])
def api_search():
    """Live search suggestions matching query string."""
    q = request.args.get('q', '').strip().lower()
    if not q:
        return jsonify([])
    matches = [t for t in all_titles_list if q in t.lower()][:10]
    return jsonify(matches)

@app.route('/api/recommend', methods=['POST'])
def api_recommend():
    """Dynamic JSON recommendation endpoint."""
    data = request.get_json(silent=True) or {}
    title = data.get('book_title') or request.form.get('book_title') or request.args.get('book_title')
    result = find_recommendations(title)
    return jsonify(result)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint for Render deployment."""
    return jsonify({
        'status': 'healthy',
        'engine': 'BookVerse AI',
        'books_catalog': books_catalog_count,
        'collaborative_models': len(pt.index)
    }), 200

# ==============================================================================
# 5. Application Runner (Local & Cloud Compatible)
# ==============================================================================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)