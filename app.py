"""
E-comXpress main app file
"""

import os
import secrets

from flask import Flask, render_template, request, redirect, url_for, session, flash
import database as db


def load_secret_key():
    """Read SECRET_KEY from the environment; generate an ephemeral one otherwise."""
    key = os.environ.get("SECRET_KEY", "").strip()
    if key:
        return key
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")) as env_file:
            for line in env_file:
                if line.strip().startswith("SECRET_KEY="):
                    value = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if value:
                        return value
    except OSError:
        pass
    return secrets.token_hex(32)


app = Flask(__name__)
app.config["SECRET_KEY"] = load_secret_key()


# helpers
def get_cart():
    if "cart" not in session:
        session["cart"] = {}
    return session["cart"]

def get_wishlist():
    if "wishlist" not in session:
        session["wishlist"] = []
    return session["wishlist"]

def get_user():
    email = session.get("user_email", "demo@ecomxpress.com")
    return db.USERS.get(email, db.DEFAULT_USER)


# inject some stuff into all templates
@app.context_processor
def global_data():
    cart = get_cart()
    return {
        "cart_count": sum(cart.values()),
        "wishlist": get_wishlist(),
        "notifications": db.NOTIFICATIONS,
        "unread_count": len([n for n in db.NOTIFICATIONS if not n["is_read"]]),
        "logged_in": session.get("logged_in", True),
        "user": get_user(),
        "categories": db.CATEGORIES
    }


# pages
@app.route("/")
def home():
    trending = [p for p in db.PRODUCTS if p.get("trending")]
    return render_template("index.html", trending=trending,
                           products=db.PRODUCTS, banners=db.BANNERS)


@app.route("/products")
def products():
    category = request.args.get("category", "All")
    query = request.args.get("q", "")
    max_price = int(request.args.get("price_max", 200000))
    sort = request.args.get("sort", "default")
    
    items = db.filter_products(category, query, max_price, sort)
    
    return render_template("products.html", products=items,
                           selected_category=category, search_query=query,
                           price_max=max_price, sort_by=sort)


@app.route("/product/<int:pid>")
def product_detail(pid):
    product = db.get_product_by_id(pid)
    if not product:
        flash("Product not found", "danger")
        return redirect(url_for("products"))
    return render_template("product_detail.html", product=product)


# cart stuff
@app.route("/cart")
def cart():
    cart_data = get_cart()
    items, total, original = [], 0, 0
    for pid_str, qty in cart_data.items():
        product = db.get_product_by_id(pid_str)
        if product:
            items.append({"product": product, "quantity": qty})
            total += product["price"] * qty
            original += product["original_price"] * qty
    return render_template("cart.html", cart_items=items,
                           total=total, original=original, savings=original - total)


@app.route("/cart/add/<int:pid>", methods=["POST"])
def add_to_cart(pid):
    cart_data = get_cart()
    key = str(pid)
    cart_data[key] = cart_data.get(key, 0) + 1
    session["cart"] = cart_data
    session.modified = True
    
    product = db.get_product_by_id(pid)
    name = product["title"][:40] if product else "Item"
    flash(f"Added '{name}' to cart", "success")
    
    return redirect(request.referrer or url_for("cart"))


@app.route("/cart/update/<int:pid>", methods=["POST"])
def update_cart(pid):
    cart_data = get_cart()
    key = str(pid)
    action = request.form.get("action")
    
    if key in cart_data:
        if action == "increase":
            cart_data[key] += 1
        elif action == "decrease":
            cart_data[key] -= 1
            if cart_data[key] <= 0:
                del cart_data[key]
        session["cart"] = cart_data
        session.modified = True
    return redirect(url_for("cart"))


@app.route("/cart/remove/<int:pid>", methods=["POST"])
def remove_from_cart(pid):
    cart_data = get_cart()
    key = str(pid)
    if key in cart_data:
        del cart_data[key]
        session["cart"] = cart_data
        session.modified = True
        flash("Item removed", "info")
    return redirect(url_for("cart"))


@app.route("/wishlist/toggle/<int:pid>", methods=["POST"])
def toggle_wishlist(pid):
    wl = get_wishlist()
    if pid in wl:
        wl.remove(pid)
        flash("Removed from wishlist", "info")
    else:
        wl.append(pid)
        flash("Added to wishlist", "success")
    session["wishlist"] = wl
    session.modified = True
    return redirect(request.referrer or url_for("home"))


# auth
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "")
        password = request.form.get("password", "")
        user = db.authenticate_user(email, password)
        if user:
            session["logged_in"] = True
            session["user_email"] = user["email"]
            flash(f"Welcome back, {user['name']}!", "success")
            return redirect(url_for("profile"))
        else:
            flash("Invalid email or password", "danger")
            return redirect(url_for("login"))
    return render_template("login.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        name = request.form.get("name")
        email = request.form.get("email")
        phone = request.form.get("phone")
        password = request.form.get("password")
        
        success, result = db.register_user(name, email, phone, password)
        if success:
            session["logged_in"] = True
            session["user_email"] = result["email"]
            flash("Account created successfully", "success")
            return redirect(url_for("profile"))
        
        flash(result, "danger")
    return render_template("register.html")


@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    step = request.args.get("step", "1")
    if request.method == "POST":
        step = request.form.get("step", "1")
        identifier = request.form.get("identifier", "")
        
        if step == "1":
            flash(f"OTP sent to {identifier}", "info")
            return render_template("forgot_password.html", step="2", identifier=identifier)
        elif step == "2":
            otp = request.form.get("otp", "")
            if otp == "123456" or len(otp) == 6:
                flash("OTP verified", "success")
                return render_template("forgot_password.html", step="3", identifier=identifier)
            flash("Invalid OTP", "danger")
            return render_template("forgot_password.html", step="2", identifier=identifier)
        elif step == "3":
            flash("Password updated", "success")
            return redirect(url_for("login"))
            
    return render_template("forgot_password.html", step="1")


@app.route("/logout")
def logout():
    session.clear()
    flash("Logged out", "info")
    return redirect(url_for("login"))


# profile & settings
@app.route("/profile", methods=["GET", "POST"])
def profile():
    user = get_user()
    if request.method == "POST":
        street = request.form.get("street")
        city = request.form.get("city")
        state = request.form.get("state")
        pincode = request.form.get("pincode")
        
        if street and city and pincode:
            user["addresses"].append({
                "id": len(user["addresses"]) + 1,
                "type": request.form.get("type", "Home"),
                "name": user["name"], 
                "street": street,
                "city": city, 
                "state": state, 
                "pincode": pincode
            })
            flash("Address added", "success")
            
    return render_template("profile.html", user=user)


@app.route("/settings", methods=["GET", "POST"])
def settings():
    if request.method == "POST":
        flash("Settings saved", "success")
    return render_template("settings.html")


# static pages
@app.route("/faq")
def faq():
    return render_template("faq.html", faqs=db.FAQS)

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/rate-us", methods=["GET", "POST"])
def rate_us():
    if request.method == "POST":
        flash("Thanks for the feedback!", "success")
        return redirect(url_for("home"))
    return render_template("rate_us.html")

@app.route("/privacy")
def privacy():
    return render_template("privacy.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    print(f"starting server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=debug)
