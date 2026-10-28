"""Selenium end-to-end test of the main workflow (teacher -> student -> teacher -> student).

NOT RUN by the author of this file: run it yourself (see README section 9).
Start the app first (npm start), then:  python tests/selenium/test_workflow.py
"""
import datetime
import os
import tempfile
import unittest

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

BASE = os.environ.get("APP_URL", "http://localhost:3000")
TITLE = "Software Engineering Assignment 1 (Selenium %s)" % datetime.datetime.now().strftime("%H%M%S")


class WorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.driver = webdriver.Chrome()  # Selenium 4 downloads the driver automatically
        cls.wait = WebDriverWait(cls.driver, 10)
        cls.upload = os.path.join(tempfile.gettempdir(), "selenium_submission.txt")
        with open(cls.upload, "w") as f:
            f.write("Selenium submission")

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()

    # ---- helpers ----
    def css(self, selector):
        return self.wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, selector)))

    def click(self, selector):
        self.wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector))).click()

    def type(self, selector, text):
        el = self.css(selector)
        el.clear()
        el.send_keys(text)

    def login(self, email, password):
        self.driver.get(BASE)
        self.type("#email", email)
        self.type("#password", password)
        self.click("#login-btn")
        self.css("#logout-btn")

    def logout(self):
        self.click("#logout-btn")
        self.css("#login-btn")

    def open_assignment_list_and_search(self):
        self.click("#nav-assignments")
        self.type("#search", TITLE)

    # ---- the workflow (test names start with a number so unittest runs them in order) ----
    def test_1_login_with_wrong_password_fails(self):
        self.driver.get(BASE)
        self.type("#email", "student@college.edu")
        self.type("#password", "wrong")
        self.click("#login-btn")
        self.assertIn("Invalid", self.css("#login-error").text)

    def test_2_teacher_creates_assignment(self):
        self.login("teacher@college.edu", "teacher123")
        self.click("#nav-assignments-new")
        self.click("#save-assignment-btn")  # empty form -> validation message
        self.wait.until(lambda d: d.find_element(By.CSS_SELECTOR, '[data-err="title"]').text != "")
        self.type("#title", TITLE)
        Select(self.css("#course_id")).select_by_visible_text("CSE3132 · Software Engineering Lab")
        self.type("#description", "Write an SRS document.")
        deadline = (datetime.datetime.now() + datetime.timedelta(days=5)).strftime("%Y-%m-%dT23:59")
        self.driver.execute_script(
            "const e=document.getElementById('deadline');e.value=arguments[0];e.dispatchEvent(new Event('input'))", deadline)
        self.type("#max_marks", "50")
        self.click("#save-assignment-btn")
        self.assertIn(TITLE, self.css("#detail-title").text)
        self.logout()

    def test_3_student_submits(self):
        self.login("student@college.edu", "student123")
        self.open_assignment_list_and_search()
        self.click("tr[data-title='%s'] .open-btn" % TITLE)
        self.click("#submit-link")
        self.css("#file").send_keys(self.upload)
        self.type("#answer_text", "Submitted by Selenium")
        self.click("#submit-work-btn")
        self.css("#detail-title")
        self.assertIn("Submitted", self.driver.find_element(By.TAG_NAME, "main").text)
        self.logout()

    def test_4_teacher_grades(self):
        self.login("teacher@college.edu", "teacher123")
        self.open_assignment_list_and_search()
        self.driver.find_element(By.XPATH, "//tr[@data-title='%s']//a[text()='Submissions']" % TITLE).click()
        card = self.css(".student-card[data-student='Rahul Verma']")
        card.find_element(By.CSS_SELECTOR, ".marks-input").send_keys("45")
        card.find_element(By.CSS_SELECTOR, ".feedback-input").send_keys("Good work from Selenium test")
        card.find_element(By.CSS_SELECTOR, ".save-grade-btn").click()
        self.wait.until(EC.text_to_be_present_in_element(
            (By.CSS_SELECTOR, ".student-card[data-student='Rahul Verma']"), "Graded"))
        self.logout()

    def test_5_student_sees_grade_after_refresh(self):
        self.login("student@college.edu", "student123")
        self.click("#nav-grades")
        self.css("#grades-table")
        self.driver.refresh()
        table = self.css("#grades-table")
        self.assertIn("Good work from Selenium test", table.text)
        self.assertIn("45", table.text)

    def test_6_student_cannot_open_teacher_or_admin_pages(self):
        for url in ("/#/assignments/new", "/#/admin"):
            self.driver.get(BASE + url)
            self.wait.until(EC.text_to_be_present_in_element((By.CSS_SELECTOR, "main"), "Access denied"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
