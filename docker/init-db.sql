-- Separate database for automated integration tests so they never touch demo data.
CREATE DATABASE pharmacy_test OWNER pharmacy;
