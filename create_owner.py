
import getpass
import sqlite3
import sys

from pwdlib import PasswordHash

DB_PATH = "/app/data/dixonwr.db"
password_hash = PasswordHash.recommended()


def main():
    username = input("Имя пользователя для owner: ").strip()

    if not username:
        print("Имя пользователя не может быть пустым.")
        sys.exit(1)

    password = getpass.getpass("Придумай пароль: ")
    confirmation = getpass.getpass("Повтори пароль: ")

    if password != confirmation:
        print("Пароли не совпадают.")
        sys.exit(1)

    if len(password) < 12:
        print("Пароль должен содержать минимум 12 символов.")
        sys.exit(1)

    try:
        with sqlite3.connect(DB_PATH) as connection:
            existing_users = connection.execute(
                "SELECT COUNT(*) FROM users"
            ).fetchone()[0]

            if existing_users:
                print(
                    "В таблице users уже есть пользователи. "
                    "Создание первого owner отменено."
                )
                sys.exit(1)

            connection.execute(
                """
                INSERT INTO users (username, password_hash, role)
                VALUES (?, ?, 'owner')
                """,
                (username, password_hash.hash(password)),
            )

        print(f"Пользователь {username} создан с ролью owner.")

    except sqlite3.Error as error:
        print(f"Ошибка базы данных: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
