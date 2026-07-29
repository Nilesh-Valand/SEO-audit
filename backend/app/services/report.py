from __future__ import annotations

import base64
import csv
import io
import os
import tempfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.db.database import SessionLocal
from app.models import AuditIssue, CrawlRun, CrawlRunScore, Project

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


class ReportService:
    def build_report(self, crawl_run_id: int) -> dict[str, Any]:
        with SessionLocal() as db:
            crawl_run = db.get(CrawlRun, crawl_run_id)
            if crawl_run is None:
                raise ValueError(f"Crawl run {crawl_run_id} not found.")

            project = db.get(Project, crawl_run.project_id)
            scores = db.scalars(
                select(CrawlRunScore)
                .where(CrawlRunScore.crawl_run_id == crawl_run_id)
                .order_by(CrawlRunScore.category.asc())
            ).all()
            issues = db.scalars(
                select(AuditIssue)
                .where(AuditIssue.crawl_run_id == crawl_run_id)
                .options(joinedload(AuditIssue.crawled_page))
                .order_by(AuditIssue.category.asc(), AuditIssue.id.asc())
            ).all()

            category_scores = {score.category: score.score for score in scores if score.category != "overall"}
            overall_score = next((score.score for score in scores if score.category == "overall"), None)

            severity_counts = {severity: 0 for severity in ("critical", "high", "medium", "low")}
            category_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
            recommendation_groups: dict[tuple[str, str, str], dict[str, Any]] = {}

            for issue in issues:
                severity_counts[issue.severity] = severity_counts.get(issue.severity, 0) + 1
                url = issue.target_url or (issue.crawled_page.url if issue.crawled_page else None)
                category_groups[issue.category].append(
                    {
                        "url": url,
                        "rule": issue.rule_id,
                        "severity": issue.severity,
                        "message": issue.message,
                    }
                )

                recommendation_key = (issue.rule_id, issue.severity, issue.category)
                if recommendation_key not in recommendation_groups:
                    recommendation_groups[recommendation_key] = {
                        "rule": issue.rule_id,
                        "severity": issue.severity,
                        "category": issue.category,
                        "message": issue.message,
                        "pages_affected": 0,
                    }
                recommendation_groups[recommendation_key]["pages_affected"] += 1

            categories = [
                {
                    "name": self._labelize(category),
                    "score": category_scores.get(category),
                    "issues": issues_for_category,
                }
                for category, issues_for_category in sorted(category_groups.items())
            ]

            recommendations = sorted(
                recommendation_groups.values(),
                key=lambda item: (
                    SEVERITY_ORDER.get(item["severity"], 99),
                    -item["pages_affected"],
                    item["rule"],
                ),
            )

            return {
                "project": {
                    "id": project.id if project else crawl_run.project_id,
                    "domain": project.domain if project else None,
                },
                "crawl_date": (
                    crawl_run.finished_at.isoformat()
                    if crawl_run.finished_at
                    else crawl_run.started_at.isoformat()
                    if crawl_run.started_at
                    else None
                ),
                "overall_score": overall_score,
                "category_scores": category_scores,
                "summary": {
                    "total_pages": crawl_run.total_urls,
                    "total_issues": len(issues),
                    "issues_by_severity": severity_counts,
                },
                "categories": categories,
                "recommendations": recommendations,
            }

    def iter_csv_rows(self, crawl_run_id: int):
        with SessionLocal() as db:
            crawl_run = db.get(CrawlRun, crawl_run_id)
            if crawl_run is None:
                raise ValueError(f"Crawl run {crawl_run_id} not found.")

            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow(["url", "category", "rule", "severity", "message"])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

            rows = db.execute(
                select(
                    AuditIssue.target_url,
                    AuditIssue.category,
                    AuditIssue.rule_id,
                    AuditIssue.severity,
                    AuditIssue.message,
                )
                .where(AuditIssue.crawl_run_id == crawl_run_id)
                .order_by(AuditIssue.category.asc(), AuditIssue.id.asc())
            )
            for row in rows:
                writer.writerow([row.target_url or "", row.category, row.rule_id, row.severity, row.message])
                yield buffer.getvalue()
                buffer.seek(0)
                buffer.truncate(0)

    def generate_pdf_file(self, crawl_run_id: int) -> tuple[str, str]:
        from jinja2 import Template
        from weasyprint import HTML

        report = self.build_report(crawl_run_id)
        charts = self._build_chart_images(report)
        template = Template(self._pdf_template())
        html = template.render(report=report, charts=charts, generated_at=datetime.utcnow().isoformat())

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            HTML(string=html).write_pdf(temp_file.name)
            return temp_file.name, f"crawl-run-{crawl_run_id}-report.pdf"

    def generate_xlsx_file(self, crawl_run_id: int) -> tuple[str, str]:
        from openpyxl import Workbook

        report = self.build_report(crawl_run_id)
        workbook = Workbook(write_only=True)

        summary_sheet = workbook.create_sheet("Summary")
        summary_sheet.append(["Project", report["project"]["domain"] or ""])
        summary_sheet.append(["Crawl Date", report["crawl_date"] or ""])
        summary_sheet.append(["Overall Score", report["overall_score"] or ""])
        summary_sheet.append([])
        summary_sheet.append(["Category", "Score"])
        for category, score in report["category_scores"].items():
            summary_sheet.append([self._labelize(category), score])

        with SessionLocal() as db:
            categories = db.scalars(
                select(AuditIssue.category)
                .where(AuditIssue.crawl_run_id == crawl_run_id)
                .distinct()
                .order_by(AuditIssue.category.asc())
            ).all()

            for category in categories:
                sheet = workbook.create_sheet(self._sheet_name(category))
                sheet.append(["url", "category", "rule", "severity", "message"])
                rows = db.execute(
                    select(
                        AuditIssue.target_url,
                        AuditIssue.category,
                        AuditIssue.rule_id,
                        AuditIssue.severity,
                        AuditIssue.message,
                    )
                    .where(
                        AuditIssue.crawl_run_id == crawl_run_id,
                        AuditIssue.category == category,
                    )
                    .order_by(AuditIssue.id.asc())
                )
                for row in rows:
                    sheet.append([row.target_url or "", row.category, row.rule_id, row.severity, row.message])

        with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as temp_file:
            workbook.save(temp_file.name)
            return temp_file.name, f"crawl-run-{crawl_run_id}-report.xlsx"

    def _build_chart_images(self, report: dict[str, Any]) -> dict[str, str]:
        import matplotlib.pyplot as plt

        category_chart = self._chart_to_data_uri(
            plt,
            list(report["category_scores"].keys()),
            [report["category_scores"][key] for key in report["category_scores"]],
            "Category Scores",
        )
        severity_counts = report["summary"]["issues_by_severity"]
        severity_chart = self._chart_to_data_uri(
            plt,
            list(severity_counts.keys()),
            [severity_counts[key] for key in severity_counts],
            "Issues by Severity",
        )
        return {"category_scores": category_chart, "severity": severity_chart}

    def _chart_to_data_uri(self, plt: Any, labels: list[str], values: list[Any], title: str) -> str:
        fig, ax = plt.subplots(figsize=(8, 3.5))
        ax.bar(labels, values, color="#0284c7")
        ax.set_title(title)
        ax.grid(axis="y", linestyle="--", alpha=0.3)
        fig.tight_layout()
        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", dpi=150)
        plt.close(fig)
        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{encoded}"

    def _sheet_name(self, category: str) -> str:
        return self._labelize(category)[:31]

    def _labelize(self, value: str) -> str:
        return value.replace("_", " ").title()

    def _pdf_template(self) -> str:
        return """
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; color: #111827; font-size: 12px; }
              .cover { page-break-after: always; text-align: center; padding-top: 120px; }
              .score { font-size: 56px; font-weight: bold; color: #0284c7; }
              .section { margin-top: 28px; }
              .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
              .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 18px; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #e5e7eb; padding: 8px; vertical-align: top; text-align: left; }
              th { background: #f9fafb; }
              h1, h2, h3 { margin: 0 0 12px 0; }
              img { width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; }
              ul { padding-left: 20px; }
            </style>
          </head>
          <body>
            <div class="cover">
              <h1>{{ report.project.domain or "SEO Audit Report" }}</h1>
              <div class="score">{{ report.overall_score if report.overall_score is not none else "--" }}</div>
              <p>Generated {{ generated_at }}</p>
            </div>

            <div class="section">
              <h2>Executive Summary</h2>
              <div class="grid">
                <div class="card">
                  <p><strong>Total Pages:</strong> {{ report.summary.total_pages }}</p>
                  <p><strong>Total Issues:</strong> {{ report.summary.total_issues }}</p>
                  <p><strong>Crawl Date:</strong> {{ report.crawl_date or "N/A" }}</p>
                </div>
                <div class="card">
                  <p><strong>Critical:</strong> {{ report.summary.issues_by_severity.critical }}</p>
                  <p><strong>High:</strong> {{ report.summary.issues_by_severity.high }}</p>
                  <p><strong>Medium:</strong> {{ report.summary.issues_by_severity.medium }}</p>
                  <p><strong>Low:</strong> {{ report.summary.issues_by_severity.low }}</p>
                </div>
              </div>
            </div>

            <div class="section">
              <h2>Charts</h2>
              <div class="grid">
                <div><img src="{{ charts.category_scores }}" alt="Category scores" /></div>
                <div><img src="{{ charts.severity }}" alt="Issues by severity" /></div>
              </div>
            </div>

            <div class="section">
              <h2>Recommendations</h2>
              <ul>
                {% for item in report.recommendations %}
                  <li><strong>{{ item.rule }}</strong> ({{ item.severity }}) - affects {{ item.pages_affected }} pages. {{ item.message }}</li>
                {% endfor %}
              </ul>
            </div>

            {% for category in report.categories %}
              <div class="section" style="page-break-before: always;">
                <h2>{{ category.name }}{% if category.score is not none %} - Score {{ category.score }}{% endif %}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>Rule</th>
                      <th>Severity</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {% for issue in category.issues %}
                      <tr>
                        <td>{{ issue.url or "" }}</td>
                        <td>{{ issue.rule }}</td>
                        <td>{{ issue.severity }}</td>
                        <td>{{ issue.message }}</td>
                      </tr>
                    {% endfor %}
                  </tbody>
                </table>
              </div>
            {% endfor %}
          </body>
        </html>
        """


def iter_file_chunks(path: str, chunk_size: int = 65536):
    with open(path, "rb") as file_handle:
        while chunk := file_handle.read(chunk_size):
            yield chunk


def remove_file(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
