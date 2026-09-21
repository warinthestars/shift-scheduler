from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(
    title="ShiftBoard API",
    description="Shift scheduling and call-board backend for the service industry",
    version="0.1.0"
)

# CORS configuration
origins = os.getenv("CORS_ORIGINS", "http://localhost,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/healthz")
async def health_check():
    return {"status": "ok", "service": "shiftboard-backend"}

@app.get("/api/v1/ping")
async def ping():
    return {"message": "pong"}
