import uuid
from typing import Optional
from pathlib import Path
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from app.core.deps import get_current_account
from app.models.account import Account

router = APIRouter()

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

@router.post("/upload")
async def upload_file(
    file: Optional[UploadFile] = File(None),
    upload: Optional[UploadFile] = File(None),
    account: Account = Depends(get_current_account)
):
    incoming_file = file or upload
    if incoming_file is None:
        raise HTTPException(status_code=422, detail="file field is required")

    # Determine type from extension or content_type
    ext = Path(incoming_file.filename).suffix.lower()
    
    # Basic validation
    file_id = str(uuid.uuid4())
    filename = f"{file_id}{ext}"
    target_path = UPLOAD_DIR / filename
    
    try:
        content = await incoming_file.read()
        with open(target_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    # Determine message type
    mtype = "document"
    content_type = incoming_file.content_type or ""
    if content_type.startswith("image/"):
        mtype = "image"
    elif content_type.startswith("video/"):
        mtype = "video"
    elif content_type.startswith("audio/"):
        mtype = "audio"
    
    return {
        "url": f"/uploads/{filename}",
        "type": mtype,
        "filename": incoming_file.filename
    }
