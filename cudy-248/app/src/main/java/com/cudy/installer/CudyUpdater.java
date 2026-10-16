package com.cudy.installer;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Checks the public update manifest and installs a verified APK through Android. */
public final class CudyUpdater {
 private static final String PACKAGE_NAME="com.cudy.installer.v22";
 private static final long MAX_APK_BYTES=150L*1024L*1024L;
 private final Activity activity;
 private final WebView webView;
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AtomicBoolean busy=new AtomicBoolean(false);
 private volatile JSONObject latestUpdate;

 public CudyUpdater(Activity activity,WebView webView){this.activity=activity;this.webView=webView;}

 /** Called automatically once the catalogue has loaded. */
 public void checkOnLaunch(){check(true);}

 @JavascriptInterface public void checkForUpdate(){check(false);}

 @JavascriptInterface public void downloadAndInstall(){
  final JSONObject update=latestUpdate;
  if(update==null){message("download_error");return;}
  if(!busy.compareAndSet(false,true)){return;}
  worker.execute(()->download(update));
 }

 private void check(boolean silent){
  if(!busy.compareAndSet(false,true))return;
  if(!silent)message("checking");
  worker.execute(()->{
   HttpURLConnection connection=null;
   try{
    String manifestUrl=activity.getString(R.string.update_manifest_url);
    connection=(HttpURLConnection)new URL(manifestUrl).openConnection();
    connection.setConnectTimeout(12000);connection.setReadTimeout(15000);
    connection.setRequestProperty("Cache-Control","no-cache");
    connection.setRequestProperty("Accept","application/json");
    if(connection.getResponseCode()!=200)throw new IllegalStateException("Manifest HTTP error");
    byte[] bytes=readLimited(connection.getInputStream(),1024*1024);
    JSONObject manifest=new JSONObject(new String(bytes,"UTF-8"));
    String url=manifest.getString("apkUrl");
    String expectedHash=manifest.getString("sha256").toLowerCase(Locale.ROOT);
    if(!url.startsWith("https://")||!expectedHash.matches("[0-9a-f]{64}"))throw new IllegalStateException("Invalid update manifest");
    long availableCode=manifest.getLong("versionCode");
    int installedCode=installedVersionCode();
    if(availableCode>installedCode){
     manifest.put("installedVersionCode",installedCode);
     latestUpdate=manifest;
     runJs("window.CudyAppUpdateAvailable&&window.CudyAppUpdateAvailable(JSON.parse("+JSONObject.quote(manifest.toString())+"));");
    }else{
     latestUpdate=null;
     if(!silent)message("no_update");
    }
   }catch(Exception error){if(!silent)message("offline");}
   finally{if(connection!=null)connection.disconnect();busy.set(false);}
  });
 }

 private void download(JSONObject update){
  HttpURLConnection connection=null;File apk=new File(activity.getCacheDir(),"cudy-update.apk");
  try{
   URL url=new URL(update.getString("apkUrl"));
   if(!"https".equalsIgnoreCase(url.getProtocol()))throw new IllegalStateException("HTTPS required");
   connection=(HttpURLConnection)url.openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
   connection.setInstanceFollowRedirects(true);connection.setRequestProperty("Cache-Control","no-cache");
   if(connection.getResponseCode()!=200)throw new IllegalStateException("APK HTTP error");
   long total=connection.getContentLength();if(total>MAX_APK_BYTES)throw new IllegalStateException("APK too large");
   long done=0;byte[] buffer=new byte[64*1024];
   try(InputStream in=connection.getInputStream();OutputStream out=new java.io.FileOutputStream(apk)){
    int count;while((count=in.read(buffer))!=-1){done+=count;if(done>MAX_APK_BYTES)throw new IllegalStateException("APK too large");out.write(buffer,0,count);
     if(total>0){final int percent=(int)Math.min(99,(done*100)/total);runJs("window.CudyAppUpdateProgress&&window.CudyAppUpdateProgress("+percent+");");}}
   }
   String actual=sha256(apk);String expected=update.getString("sha256").toLowerCase(Locale.ROOT);
   if(!actual.equals(expected))throw new IllegalStateException("APK checksum mismatch");
   PackageInfo candidate=archiveInfo(apk.getAbsolutePath());
   if(candidate==null||!PACKAGE_NAME.equals(candidate.packageName)||versionCode(candidate)<update.getLong("versionCode"))throw new IllegalStateException("APK identity/version mismatch");
   if(!sameSigner(candidate))throw new IllegalStateException("APK signing key mismatch");
   install(apk);
  }catch(Exception error){apk.delete();message("download_error");}
  finally{if(connection!=null)connection.disconnect();busy.set(false);}
 }

 private void install(File apk)throws Exception{
  PackageInstaller installer=activity.getPackageManager().getPackageInstaller();
  PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
  params.setAppPackageName(PACKAGE_NAME);
  int sessionId=installer.createSession(params);
  try(PackageInstaller.Session session=installer.openSession(sessionId);InputStream in=new FileInputStream(apk);OutputStream out=session.openWrite("cudy-update.apk",0,apk.length())){
   byte[] buffer=new byte[64*1024];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);session.fsync(out);
   Intent status=new Intent(activity,InstallStatusReceiver.class).setAction(InstallStatusReceiver.ACTION_INSTALL_STATUS);
   int flags=PendingIntent.FLAG_UPDATE_CURRENT;if(Build.VERSION.SDK_INT>=23)flags|=PendingIntent.FLAG_IMMUTABLE;
   PendingIntent pending=PendingIntent.getBroadcast(activity,sessionId,status,flags);
   session.commit(pending.getIntentSender());message("install_ready");
  }catch(Exception error){installer.abandonSession(sessionId);throw error;}
 }

 private boolean sameSigner(PackageInfo candidate)throws Exception{
  PackageInfo installed=activity.getPackageManager().getPackageInfo(PACKAGE_NAME,PackageManager.GET_SIGNATURES);
  if(installed.signatures==null||candidate.signatures==null||installed.signatures.length==0||candidate.signatures.length==0)return false;
  return sha256(installed.signatures[0].toByteArray()).equals(sha256(candidate.signatures[0].toByteArray()));
 }

 @SuppressWarnings("deprecation") private PackageInfo archiveInfo(String path){return activity.getPackageManager().getPackageArchiveInfo(path,PackageManager.GET_SIGNATURES);}
 @SuppressWarnings("deprecation") private int installedVersionCode()throws Exception{return (int)versionCode(activity.getPackageManager().getPackageInfo(PACKAGE_NAME,0));}
 @SuppressWarnings("deprecation") private long versionCode(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}

 private String sha256(File file)throws Exception{
  MessageDigest digest=MessageDigest.getInstance("SHA-256");
  try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[64*1024];int count;while((count=in.read(buffer))!=-1)digest.update(buffer,0,count);}
  return hex(digest.digest());
 }
 private String sha256(byte[] bytes)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(bytes));}
 private String hex(byte[] bytes){StringBuilder out=new StringBuilder(bytes.length*2);for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&0xff));return out.toString();}
 private byte[] readLimited(InputStream input,int maximum)throws Exception{
  try(InputStream in=input;java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){
   byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1){if(out.size()+count>maximum)throw new IllegalStateException("Manifest too large");out.write(buffer,0,count);}return out.toByteArray();
  }
 }
 private void message(String key){runJs("window.CudyAppUpdateMessage&&window.CudyAppUpdateMessage("+JSONObject.quote(key)+");");}
 private void runJs(String code){activity.runOnUiThread(()->{if(webView!=null)webView.evaluateJavascript(code,null);});}
 public void shutdown(){worker.shutdownNow();}
}
