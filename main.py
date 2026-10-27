import re
import json
import sqlite3
import os
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from pwdlib import PasswordHash

password_hash = PasswordHash.recommended()


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path("/app/data") if Path("/app/data").exists() else BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "dixonwr.db"


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    phone = phone.strip()
    if not phone:
        return None
    normalized = re.sub(r"[^\d+]", "", phone)
    if normalized.count("+") > 1 or ("+" in normalized and not normalized.startswith("+")):
        raise ValueError("Проверьте формат номера телефона.")
    if len(normalized.replace("+", "")) < 5:
        raise ValueError("Номер телефона слишком короткий.")
    return normalized


def normalize_instagram(username: str | None) -> str | None:
    if not username:
        return None
    username = username.strip().lstrip("@").lower()
    return username or None


def init_db():
    try:
        with get_connection() as connection:
            # Customers table
            connection.execute("""
                CREATE TABLE IF NOT EXISTS customers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    full_name TEXT NOT NULL,
                    phone TEXT,
                    instagram_username TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            connection.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone
                ON customers(phone)
                WHERE phone IS NOT NULL AND phone != ''
            """)
            connection.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_instagram
                ON customers(instagram_username COLLATE NOCASE)
                WHERE instagram_username IS NOT NULL AND instagram_username != ''
            """)

            # Products table
            connection.execute("""
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    category TEXT,
                    price_byn REAL NOT NULL,
                    sizes TEXT,
                    in_stock INTEGER DEFAULT 1
                )
            """)

            # Orders table
            connection.execute("""
                CREATE TABLE IF NOT EXISTS orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    customer_id INTEGER NOT NULL,
                    status TEXT DEFAULT 'NEW',
                    total_price REAL NOT NULL,
                    delivery_city TEXT DEFAULT 'Минск',
                    comment TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
                )
            """)

            # Order items table
            connection.execute("""
                CREATE TABLE IF NOT EXISTS order_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    product_id INTEGER NOT NULL,
                    size_selected TEXT,
                    quantity INTEGER DEFAULT 1,
                    price_at_order REAL NOT NULL,
                    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                    FOREIGN KEY (product_id) REFERENCES products(id)
                )
            """)
            
            # Users table
            connection.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Seed products if empty
            count = connection.execute("SELECT COUNT(*) FROM products").fetchone()[0]
            if count == 0:
                products_file = BASE_DIR / "products.json"
                if products_file.exists():
                    with open(products_file, "r", encoding="utf-8") as pf:
                        items = json.load(pf)
                        for item in items:
                            sizes_list = item.get("sizes", [])
                            if isinstance(sizes_list, list):
                                stock_dict = {sz: 5 for sz in sizes_list}
                                sizes_val = json.dumps(stock_dict, ensure_ascii=False)
                            else:
                                sizes_val = str(sizes_list)

                            connection.execute("""
                                INSERT INTO products (name, category, price_byn, sizes, in_stock)
                                VALUES (?, ?, ?, ?, ?)
                            """, (
                                item["name"],
                                item.get("category", "Каталог"),
                                item["price_byn"],
                                sizes_val,
                                1 if item.get("in_stock", True) else 0
                            ))
            connection.commit()
    except Exception as err:
        print("init_db error:", err)


# Execute DB setup
init_db()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="DixonWR CRM", lifespan=lifespan)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")

class LoginMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if (
            path == "/login"
            or path.startswith("/static/")
            or path == "/favicon.ico"
        ):
            return await call_next(request)

        if not request.session.get("user_id"):
            if path.startswith("/api/"):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication required"},
                )

            return RedirectResponse("/login", status_code=303)

        return await call_next(request)


app.add_middleware(LoginMiddleware)
def require_owner(request: Request):
    if request.session.get("role") != "owner":
        raise HTTPException(
            status_code=403,
            detail="Доступ разрешён только владельцу CRM",
        )
    return True

app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    same_site="lax",
    https_only=False,
)

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if request.session.get("user_id"):
        return RedirectResponse("/", status_code=303)

    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"error": None},
    )


@app.post("/login", response_class=HTMLResponse)
async def login_submit(request: Request):
    form = await request.form()
    username = str(form.get("username", "")).strip()
    password = str(form.get("password", ""))

    with get_connection() as connection:
        user = connection.execute(
            """
            SELECT id, username, password_hash, role
            FROM users
            WHERE username = ? AND is_active = 1
            """,
            (username,),
        ).fetchone()

    if not user or not password_hash.verify(password, user["password_hash"]):
        return templates.TemplateResponse(
            request=request,
            name="login.html",
            context={"error": "Неверное имя пользователя или пароль."},
            status_code=401,
        )

    request.session.clear()
    request.session["user_id"] = user["id"]
    request.session["username"] = user["username"]
    request.session["role"] = user["role"]

    return RedirectResponse("/", status_code=303)


@app.post("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


class CustomerCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    phone: str | None = None
    instagram_username: str | None = None


class OrderItemCreate(BaseModel):
    product_id: int
    size_selected: str | None = None
    quantity: int = Field(default=1, ge=1)


class OrderCreate(BaseModel):
    customer_id: int
    delivery_city: str | None = "Минск"
    comment: str | None = None
    status: str = "NEW"
    items: list[OrderItemCreate] = Field(min_items=1)


def customer_to_dict(customer):
    return {
        "id": customer["id"],
        "full_name": customer["full_name"],
        "phone": customer["phone"],
        "instagram_username": customer["instagram_username"],
        "created_at": customer["created_at"],
        "updated_at": customer["updated_at"],
    }


def get_customer_row(customer_id: int):
    with get_connection() as connection:
        customer = connection.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    if not customer:
        raise HTTPException(status_code=404, detail="Клиент не найден.")
    return customer


# HTML Page Routes

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    init_db()
    total = 0
    new_this_month = 0
    with_insta = 0
    orders_pending = 0
    orders_completed_month = 0
    recent = []

    try:
        with get_connection() as connection:
            total = connection.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
            new_this_month = connection.execute(
                "SELECT COUNT(*) FROM customers WHERE created_at >= datetime('now', '-30 days')"
            ).fetchone()[0]
            with_insta = connection.execute(
                "SELECT COUNT(*) FROM customers WHERE instagram_username IS NOT NULL AND instagram_username != ''"
            ).fetchone()[0]
            orders_pending = connection.execute(
                "SELECT COUNT(*) FROM orders WHERE status IN ('NEW', 'IN_PROGRESS')"
            ).fetchone()[0]
            orders_completed_month = connection.execute(
                "SELECT COUNT(*) FROM orders WHERE status = 'DELIVERED' AND created_at >= datetime('now', '-30 days')"
            ).fetchone()[0]
            recent_rows = connection.execute(
                "SELECT * FROM customers ORDER BY updated_at DESC, id DESC LIMIT 5"
            ).fetchall()
            recent = [customer_to_dict(r) for r in recent_rows]
    except Exception as e:
        print("Home error:", e)

    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={
            "active_page": "home",
            "total_customers": total,
            "new_this_month": new_this_month,
            "with_insta": with_insta,
            "orders_pending": orders_pending,
            "orders_completed_month": orders_completed_month,
            "recent_customers": recent,
        },
    )


@app.get("/customers", response_class=HTMLResponse)
def customers_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="customers.html",
        context={"active_page": "customers"},
    )


@app.get("/customers/new", response_class=HTMLResponse)
def new_customer_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="customer_form.html",
        context={
            "active_page": "customers",
            "mode": "create",
            "customer": None,
        },
    )


@app.get("/customers/{customer_id}/edit", response_class=HTMLResponse)
def edit_customer_page(request: Request, customer_id: int):
    customer = customer_to_dict(get_customer_row(customer_id))
    return templates.TemplateResponse(
        request=request,
        name="customer_form.html",
        context={
            "active_page": "customers",
            "mode": "edit",
            "customer": customer,
        },
    )


@app.get("/customers/{customer_id}", response_class=HTMLResponse)
def customer_detail_page(request: Request, customer_id: int):
    init_db()
    customer = customer_to_dict(get_customer_row(customer_id))
    customer_orders = []
    ltv_total = 0.0
    paid_orders_count = 0

    try:
        with get_connection() as conn:
            rows = conn.execute("""
                SELECT o.*, 
                       (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as items_count
                FROM orders o
                WHERE o.customer_id = ?
                ORDER BY o.id DESC
            """, (customer_id,)).fetchall()
            customer_orders = [dict(r) for r in rows]

            for o in customer_orders:
                # Strictly exclude CANCELLED orders from LTV
                if o.get("status") in ("DELIVERED", "NEW", "IN_PROGRESS", "SHIPPED"):
                    ltv_total += float(o.get("total_price") or 0)
                if o.get("status") == "DELIVERED":
                    paid_orders_count += 1
    except Exception as e:
        print("Customer detail error:", e)

    avg_order_value = round(ltv_total / max(1, len([o for o in customer_orders if o.get("status") != "CANCELLED"])), 2) if customer_orders else 0.0
    customer["ltv_total"] = round(ltv_total, 2)
    customer["paid_orders_count"] = paid_orders_count
    customer["avg_order_value"] = avg_order_value

    return templates.TemplateResponse(
        request=request,
        name="customer_detail.html",
        context={
            "active_page": "customers",
            "customer": customer,
            "orders": customer_orders,
        },
    )


# Orders HTML Pages

@app.get("/orders", response_class=HTMLResponse)
def orders_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="orders.html",
        context={"active_page": "orders"},
    )


@app.get("/orders/new", response_class=HTMLResponse)
def new_order_page(request: Request, customer_id: int | None = None):
    initial_customer = None
    if customer_id:
        try:
            initial_customer = customer_to_dict(get_customer_row(customer_id))
        except HTTPException:
            pass
    return templates.TemplateResponse(
        request=request,
        name="order_form.html",
        context={
            "active_page": "orders",
            "initial_customer": initial_customer
        },
    )


@app.get("/orders/{order_id}", response_class=HTMLResponse)
def order_detail_page(request: Request, order_id: int):
    init_db()
    with get_connection() as conn:
        order = conn.execute("SELECT o.*, c.full_name, c.phone, c.instagram_username FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.id = ?", (order_id,)).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Заказ не найден.")
        items = conn.execute("SELECT oi.*, p.name as product_name, p.category FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?", (order_id,)).fetchall()
    
    return templates.TemplateResponse(
        request=request,
        name="order_detail.html",
        context={
            "active_page": "orders",
            "order": dict(order),
            "items": [dict(i) for i in items]
        },
    )


# API Routes for Customers

@app.get("/api/customers/search")
def search_customers(q: str = ""):
    query = q.strip()
    if not query:
        return []
    phone_query = re.sub(r"\D", "", query)
    instagram_query = query.lstrip("@").strip().lower()
    name_query = query.lower()
    with get_connection() as connection:
        rows = connection.execute("""
            SELECT * FROM customers
            WHERE
                (? != '' AND phone IS NOT NULL AND phone != '' AND phone LIKE ?)
                OR (? != '' AND instagram_username IS NOT NULL AND TRIM(instagram_username) != '' AND LOWER(TRIM(instagram_username)) LIKE ?)
                OR (? != '' AND full_name IS NOT NULL AND LOWER(full_name) LIKE ?)
            ORDER BY full_name
            LIMIT 50
        """, (phone_query, f"%{phone_query}%", instagram_query, f"%{instagram_query}%", name_query, f"%{name_query}%")).fetchall()
    return [customer_to_dict(row) for row in rows]


@app.get("/api/customers")
def list_customers(limit: int = 50, offset: int = 0, sort_by: str = "name", order: str = "asc"):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    sort_columns = {"id": "id", "name": "full_name", "updated_at": "updated_at"}
    column = sort_columns.get(sort_by, "full_name")
    direction = "DESC" if order.lower() == "desc" else "ASC"
    with get_connection() as connection:
        total = connection.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        rows = connection.execute(f"SELECT * FROM customers ORDER BY {column} {direction}, id ASC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    return {"items": [customer_to_dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}


@app.get("/api/customers/{customer_id}")
def get_customer(customer_id: int):
    return customer_to_dict(get_customer_row(customer_id))


def validate_customer(customer: CustomerCreate):
    full_name = customer.full_name.strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Укажите имя клиента.")
    try:
        phone = normalize_phone(customer.phone)
        instagram = normalize_instagram(customer.instagram_username)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if not phone and not instagram:
        raise HTTPException(status_code=400, detail="Укажите телефон или Instagram username.")
    return full_name, phone, instagram


def check_duplicates(phone, instagram, exclude_id=None):
    with get_connection() as connection:
        if phone:
            sql = "SELECT id FROM customers WHERE phone = ?"
            params = [phone]
            if exclude_id is not None:
                sql += " AND id != ?"
                params.append(exclude_id)
            row = connection.execute(sql, params).fetchone()
            if row:
                raise HTTPException(status_code=409, detail=f"Этот телефон уже принадлежит клиенту с ID {row['id']}.")
        if instagram:
            sql = "SELECT id FROM customers WHERE LOWER(instagram_username) = LOWER(?)"
            params = [instagram]
            if exclude_id is not None:
                sql += " AND id != ?"
                params.append(exclude_id)
            row = connection.execute(sql, params).fetchone()
            if row:
                raise HTTPException(status_code=409, detail=f"Этот Instagram уже принадлежит клиенту с ID {row['id']}.")


@app.post("/api/customers", status_code=201)
def create_customer(customer: CustomerCreate):
    full_name, phone, instagram = validate_customer(customer)
    check_duplicates(phone, instagram)
    try:
        with get_connection() as connection:
            cursor = connection.execute("INSERT INTO customers (full_name, phone, instagram_username) VALUES (?, ?, ?)", (full_name, phone, instagram))
            connection.commit()
            row = connection.execute("SELECT * FROM customers WHERE id = ?", (cursor.lastrowid,)).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Клиент с такими данными уже существует.")
    return customer_to_dict(row)


@app.put("/api/customers/{customer_id}")
def update_customer(customer_id: int, customer: CustomerCreate):
    full_name, phone, instagram = validate_customer(customer)
    get_customer_row(customer_id)
    check_duplicates(phone, instagram, exclude_id=customer_id)
    try:
        with get_connection() as connection:
            connection.execute("UPDATE customers SET full_name = ?, phone = ?, instagram_username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (full_name, phone, instagram, customer_id))
            connection.commit()
            row = connection.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Клиент с такими данными уже существует.")
    return customer_to_dict(row)


@app.delete("/api/customers/{customer_id}")
def delete_customer(customer_id: int):
    get_customer_row(customer_id)
    with get_connection() as connection:
        connection.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
        connection.commit()
    return {"status": "success", "id": customer_id}


# API Routes for Products & Orders

@app.get("/api/products")
def list_products():
    init_db()
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM products ORDER BY category, name").fetchall()
    return [dict(row) for row in rows]


@app.get("/api/orders")
def list_orders(limit: int = 50, offset: int = 0, status: str | None = None):
    init_db()
    with get_connection() as conn:
        query = "SELECT o.*, c.full_name, c.phone, c.instagram_username FROM orders o JOIN customers c ON o.customer_id = c.id"
        params = []
        if status:
            query += " WHERE o.status = ?"
            params.append(status)
        query += " ORDER BY o.id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(query, params).fetchall()
        
        total = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
    return {"items": [dict(r) for r in rows], "total": total}


@app.post("/api/orders", status_code=201)
def create_order(order: OrderCreate):
    init_db()
    get_customer_row(order.customer_id)
    
    with get_connection() as conn:
        total_price = 0.0
        items_to_save = []
        stock_updates = []
        
        for item in order.items:
            prod = conn.execute("SELECT * FROM products WHERE id = ?", (item.product_id,)).fetchone()
            if not prod:
                raise HTTPException(status_code=400, detail=f"Товар с ID {item.product_id} не найден.")
            
            # Inventory stock deduction logic
            sizes_stock = {}
            if prod["sizes"]:
                try:
                    sizes_stock = json.loads(prod["sizes"]) if prod["sizes"].startswith("{") else {}
                except Exception:
                    pass
            
            size_key = item.size_selected or "one size"
            if sizes_stock and size_key in sizes_stock:
                current_qty = sizes_stock[size_key]
                if current_qty < item.quantity:
                    raise HTTPException(
                        status_code=400, 
                        detail=f"Недостаточно товара '{prod['name']}' размера '{size_key}' на складе! В наличии: {current_qty} шт."
                    )
                # Deduct requested quantity
                sizes_stock[size_key] -= item.quantity
                
                # Check if total stock is > 0
                has_stock = 1 if sum(sizes_stock.values()) > 0 else 0
                stock_updates.append((json.dumps(sizes_stock, ensure_ascii=False), has_stock, prod["id"]))

            price = prod["price_byn"]
            item_total = price * item.quantity
            total_price += item_total
            items_to_save.append((item.product_id, item.size_selected, item.quantity, price))
        
        # Apply stock updates
        for new_sizes_json, has_stock, p_id in stock_updates:
            conn.execute("UPDATE products SET sizes = ?, in_stock = ? WHERE id = ?", (new_sizes_json, has_stock, p_id))

        cursor = conn.execute("""
            INSERT INTO orders (customer_id, status, total_price, delivery_city, comment)
            VALUES (?, ?, ?, ?, ?)
        """, (order.customer_id, order.status, total_price, order.delivery_city, order.comment))
        
        order_id = cursor.lastrowid
        
        for p_id, size_sel, qty, pr in items_to_save:
            conn.execute("""
                INSERT INTO order_items (order_id, product_id, size_selected, quantity, price_at_order)
                VALUES (?, ?, ?, ?, ?)
            """, (order_id, p_id, size_sel, qty, pr))
        
        conn.commit()
            
    return {"status": "created", "order_id": order_id, "total_price": total_price}


@app.put("/api/orders/{order_id}/status")
def update_order_status(order_id: int, payload: dict):
    init_db()
    new_status = payload.get("status")
    if not new_status:
        raise HTTPException(status_code=400, detail="Укажите новый статус.")
    with get_connection() as conn:
        conn.execute("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_status, order_id))
        conn.commit()
    return {"status": "updated", "order_id": order_id, "new_status": new_status}


@app.delete("/api/orders/{order_id}")
def delete_order(order_id: int):
    init_db()
    with get_connection() as conn:
        conn.execute("DELETE FROM orders WHERE id = ?", (order_id,))
        conn.commit()
    return {"status": "deleted", "order_id": order_id}

# HTML маршруты для каталога товаров

@app.get("/products", response_class=HTMLResponse)
def products_page(request: Request):
    return templates.TemplateResponse(request=request, name="products.html", context={"active_page": "products"})


@app.get("/products/new", response_class=HTMLResponse)
def new_product_page(request: Request):
    return templates.TemplateResponse(request=request, name="product_form.html", context={"active_page": "products", "product": None})


@app.get("/products/{product_id}/edit", response_class=HTMLResponse)
def edit_product_page(request: Request, product_id: int):
    with get_connection() as conn:
        prod = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if not prod:
        raise HTTPException(status_code=404, detail="Товар не найден.")
    return templates.TemplateResponse(request=request, name="product_form.html", context={"active_page": "products", "product": dict(prod)})


# Модель валидации товара
class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = "Каталог"
    price_byn: float = Field(gt=0)
    sizes: str | None = None
    in_stock: bool = True


# CRUD API для управления товарами

@app.post("/api/products", status_code=201)
def create_product(product: ProductCreate):
    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO products (name, category, price_byn, sizes, in_stock)
            VALUES (?, ?, ?, ?, ?)
        """, (product.name.strip(), product.category, product.price_byn, product.sizes, 1 if product.in_stock else 0))
        conn.commit()
        prod_id = cursor.lastrowid
    return {"status": "created", "id": prod_id}


@app.put("/api/products/{product_id}")
def update_product(product_id: int, product: ProductCreate):
    with get_connection() as conn:
        conn.execute("""
            UPDATE products
            SET name = ?, category = ?, price_byn = ?, sizes = ?, in_stock = ?
            WHERE id = ?
        """, (product.name.strip(), product.category, product.price_byn, product.sizes, 1 if product.in_stock else 0, product_id))
        conn.commit()
    return {"status": "updated", "id": product_id}


@app.delete("/api/products/{product_id}")
def delete_product_api(product_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
        conn.commit()
    return {"status": "deleted", "id": product_id}


# HTML & API Routes for Analytics & Financial Reports

@app.get("/analytics", response_class=HTMLResponse)
def analytics_page(request: Request):
    return templates.TemplateResponse(request=request, name="analytics.html", context={"active_page": "analytics"})


@app.get("/api/analytics")
def get_analytics_data(start_date: str | None = None, end_date: str | None = None):
    init_db()
    with get_connection() as conn:
        # Build date condition for SQL
        date_where = ""
        params = []
        if start_date:
            date_where += " AND created_at >= ?"
            params.append(start_date + " 00:00:00")
        if end_date:
            date_where += " AND created_at <= ?"
            params.append(end_date + " 23:59:59")

        # 1. Total paid revenue (DELIVERED only)
        rev_row = conn.execute(f"SELECT SUM(total_price), COUNT(*) FROM orders WHERE status = 'DELIVERED'{date_where}", params).fetchone()
        revenue_paid = float(rev_row[0] or 0)
        paid_orders_count = int(rev_row[1] or 0)

        # 2. Total active non-cancelled orders (NEW, IN_PROGRESS, SHIPPED, DELIVERED -- strictly EXCLUDING CANCELLED)
        tot_row = conn.execute(f"SELECT COUNT(*), SUM(total_price) FROM orders WHERE status != 'CANCELLED'{date_where}", params).fetchone()
        total_orders_count = int(tot_row[0] or 0)
        potential_revenue = float(tot_row[1] or 0)

        avg_order = round(revenue_paid / paid_orders_count, 2) if paid_orders_count > 0 else 0.0

        # 3. Top LTV customers leaderboard (EXCLUDING CANCELLED orders)
        top_ltv_rows = conn.execute("""
            SELECT c.id, c.full_name, c.phone, c.instagram_username,
                   COUNT(CASE WHEN o.status != 'CANCELLED' THEN o.id END) as total_orders,
                   SUM(CASE WHEN o.status = 'DELIVERED' THEN 1 ELSE 0 END) as paid_orders,
                   SUM(CASE WHEN o.status != 'CANCELLED' THEN o.total_price ELSE 0 END) as ltv_val
            FROM customers c
            JOIN orders o ON c.id = o.customer_id
            GROUP BY c.id
            HAVING ltv_val > 0
            ORDER BY ltv_val DESC
            LIMIT 10
        """).fetchall()

        # 4. Daily revenue chart points (EXCLUDING CANCELLED orders)
        daily_rows = conn.execute(f"""
            SELECT DATE(created_at) as order_date, 
                   SUM(CASE WHEN status != 'CANCELLED' THEN total_price ELSE 0 END) as daily_sum,
                   COUNT(CASE WHEN status != 'CANCELLED' THEN 1 END) as daily_count
            FROM orders
            WHERE status != 'CANCELLED' {date_where}
            GROUP BY DATE(created_at)
            ORDER BY order_date ASC
            LIMIT 60
        """, params).fetchall()

        # 5. Category sales breakdown (EXCLUDING CANCELLED orders)
        cat_rows = conn.execute(f"""
            SELECT p.category, SUM(oi.price_at_order * oi.quantity) as cat_sum
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN orders o ON oi.order_id = o.id
            WHERE o.status != 'CANCELLED' {date_where.replace('created_at', 'o.created_at')}
            GROUP BY p.category
            ORDER BY cat_sum DESC
        """, params).fetchall()

        avg_ltv = 0.0
        if top_ltv_rows:
            avg_ltv = round(sum(r["ltv_val"] for r in top_ltv_rows) / len(top_ltv_rows), 2)

    return {
        "revenue_paid": round(revenue_paid, 2),
        "paid_orders_count": paid_orders_count,
        "total_orders_count": total_orders_count,
        "potential_revenue": round(potential_revenue, 2),
        "avg_order": avg_order,
        "avg_ltv": avg_ltv,
        "top_customers": [dict(r) for r in top_ltv_rows],
        "daily_chart": [dict(r) for r in daily_rows],
        "category_sales": [dict(r) for r in cat_rows]
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)
