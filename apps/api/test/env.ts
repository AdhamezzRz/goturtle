// Runs before every test file (jest setupFiles): point the app at the test database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'mysql://goturtle:goturtle@127.0.0.1:3306/goturtle_test';
process.env.IN_PROCESS_JOBS = 'false';
process.env.DB_AUTO_MIGRATE = 'false';
process.env.EXPOSE_OTP = 'true';
process.env.CRON_SECRET = 'test-cron';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/tmp/goturtle-test-uploads';
process.env.BOOTSTRAP_ADMIN_PHONE = '+201000000000';
process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@goturtle.test';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'Admin@12345';
