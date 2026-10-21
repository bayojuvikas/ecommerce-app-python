"""Build a fully static export of the E-comXpress Flask app for GitHub Pages.

GitHub Pages can only serve static files, so this script renders every GET
route with Flask's test client, rewrites the internal links to relative static
paths and injects `static_export/site.js`, which emulates the Flask session
behaviour (cart, wishlist, authentication) in the browser.

Usage:
    python build_static.py [output_dir]
"""

import json
import os
import re
import shutil
import sys

import app as flask_app
import database as db

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(HERE, "site")

STATIC_ROUTES = {
    "/": "index.html",
    "/products": "products/index.html",
    "/cart": "cart/index.html",
    "/login": "login/index.html",
    "/register": "register/index.html",
    "/forgot-password": "forgot-password/index.html",
    "/profile": "profile/index.html",
    "/settings": "settings/index.html",
    "/faq": "faq/index.html",
    "/about": "about/index.html",
    "/rate-us": "rate-us/index.html",
    "/privacy": "privacy/index.html",
    "/logout": "login/index.html",
}

PRODUCT_ROUTE_RE = re.compile(r"^/product/(\d+)$")
HREF_RE = re.compile(r"href=(['\"])(/[^'\"]*)\1")
FORM_RE = re.compile(r"<form\b[^>]*>", re.IGNORECASE)
ACTION_RE = re.compile(r"action\s*=\s*(['\"])([^'\"]*)\1", re.IGNORECASE)
METHOD_RE = re.compile(r"method\s*=\s*(['\"])([^'\"]*)\1", re.IGNORECASE)


def static_path_for(url_path):
    """Map a Flask route to the file that holds its static rendering."""
    match = PRODUCT_ROUTE_RE.match(url_path)
    if match:
        return "product/{0}/index.html".format(match.group(1))
    return STATIC_ROUTES.get(url_path)


def relative_link(target, current_file):
    """Relative URL from the directory of `current_file` to `target`."""
    base_dir = os.path.dirname(current_file) or "."
    relative = os.path.relpath(target, base_dir).replace(os.sep, "/")
    if relative.startswith("./"):
        relative = relative[2:]
    return relative


def rewrite_links(html, current_file):
    """Rewrite internal links/forms so they work from a static host."""

    def link_repl(match):
        quote, url = match.group(1), match.group(2)
        path, _, query = url.partition("?")
        target = static_path_for(path)
        if not target:
            return match.group(0)
        new_url = relative_link(target, current_file)
        if query:
            new_url += "?" + query
        return "href={0}{1}{0}".format(quote, new_url)

    html = HREF_RE.sub(link_repl, html)

    def form_repl(match):
        tag = match.group(0)
        action_match = ACTION_RE.search(tag)
        if not action_match:
            return tag
        action = action_match.group(2)
        if not action.startswith("/"):
            return tag
        method_match = METHOD_RE.search(tag)
        method = method_match.group(2).upper() if method_match else "GET"
        path, _, query = action.partition("?")
        original = path + (("?" + query) if query else "")

        if method == "POST":
            tag = ACTION_RE.sub(lambda m: 'action="#"', tag, count=1)
            if "data-ecx-action" not in tag:
                tag = tag[:-1] + ' data-ecx-action="{0}"'.format(original) + ">"
            return tag

        target = static_path_for(path)
        if not target:
            return tag
        new_action = relative_link(target, current_file)
        if query:
            new_action += "?" + query
        return ACTION_RE.sub(lambda m: 'action="{0}"'.format(new_action), tag, count=1)

    return FORM_RE.sub(form_repl, html)


def inject_assets(html, current_file):
    base = relative_link("assets/site.js", current_file)
    base = base[: -len("site.js")]
    tags = (
        '<script src="{0}data.js"></script>\n'
        '<script src="{0}site.js"></script>\n'
    ).format(base)
    return html.replace("</body>", tags + "</body>")


def render(client, url):
    response = client.get(url)
    if response.status_code != 200:
        raise RuntimeError("render failed for {0} -> {1}".format(url, response.status_code))
    return response.get_data(as_text=True)


def write_page(output_dir, target, html):
    output_file = os.path.join(output_dir, target.replace("/", os.sep))
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as handle:
        handle.write(html)


def build(output_dir=DEFAULT_OUTPUT):
    if os.path.isdir(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir)

    client = flask_app.app.test_client()
    pages = [(route, static_path_for(route)) for route in STATIC_ROUTES if route != "/logout"]

    for url, target in pages:
        html = render(client, url)
        html = rewrite_links(html, target)
        html = inject_assets(html, target)
        write_page(output_dir, target, html)

    with client.session_transaction() as session:
        session["cart"] = {str(product["id"]): 1 for product in db.PRODUCTS}

    cart_html = render(client, "/cart")
    cart_html = rewrite_links(cart_html, static_path_for("/cart"))
    cart_html = inject_assets(cart_html, static_path_for("/cart"))
    write_page(output_dir, static_path_for("/cart"), cart_html)

    for product in db.PRODUCTS:
        route = "/product/{0}".format(product["id"])
        html = render(client, route)
        html = rewrite_links(html, static_path_for(route))
        html = inject_assets(html, static_path_for(route))
        write_page(output_dir, static_path_for(route), html)

    assets_dir = os.path.join(output_dir, "assets")
    os.makedirs(assets_dir, exist_ok=True)
    shutil.copyfile(
        os.path.join(HERE, "static_export", "site.js"),
        os.path.join(assets_dir, "site.js"),
    )

    with open(os.path.join(assets_dir, "data.js"), "w", encoding="utf-8") as handle:
        handle.write("window.ECX_PRODUCTS = ")
        handle.write(json.dumps(db.PRODUCTS, ensure_ascii=False, indent=2))
        handle.write(";\nwindow.ECX_USERS = ")
        handle.write(json.dumps(db.USERS, ensure_ascii=False, indent=2))
        handle.write(";\n")

    with open(os.path.join(output_dir, "404.html"), "w", encoding="utf-8") as handle:
        handle.write(
            "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<title>Page not found - E-comXpress</title>"
            "<link href=\"https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css\" rel=\"stylesheet\">"
            "</head><body class=\"bg-body\"><div class=\"container text-center py-5\">"
            "<h1 class=\"display-1 fw-bold text-primary\">404</h1>"
            "<p class=\"lead text-muted\">The page you are looking for does not exist.</p>"
            "<a href=\"./index.html\" class=\"btn btn-primary\">Back to Home</a>"
            "</div></body></html>\n"
        )

    open(os.path.join(output_dir, ".nojekyll"), "w").close()

    print("Static export written to {0}".format(output_dir))
    print("Pages: {0}".format(len(pages) + len(db.PRODUCTS) + 1))


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT)
