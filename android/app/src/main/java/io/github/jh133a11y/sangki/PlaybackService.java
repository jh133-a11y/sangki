package io.github.jh133a11y.sangki;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

public class PlaybackService extends Service {
    private static final String CHANNEL = "music";
    private static final int NOTIFICATION_ID = 1;
    private static volatile String state = "{\"queue\":[],\"index\":-1,\"playing\":false}";
    private JSONArray queue = new JSONArray();
    private int index = -1;
    private String queueName = "";
    private String repeat = "off";
    private String error = "";
    private MediaPlayer player;
    private boolean prepared;
    private boolean playRequested;
    private boolean resumeOnFocusGain;
    private boolean hasFocus;
    private boolean receiverRegistered;
    private boolean foreground;
    private MediaSession mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            publish();
            handler.postDelayed(this, 500);
        }
    };
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            pause();
        }
    };

    public static String snapshot() { return state; }
    public static boolean validAction(String action) {
        return "queue".equals(action) || "play".equals(action) || "pause".equals(action)
            || "next".equals(action) || "previous".equals(action) || "repeat".equals(action)
            || "seek".equals(action) || "stop".equals(action);
    }

    @Override public void onCreate() {
        super.onCreate();
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener(change -> {
                if (change == AudioManager.AUDIOFOCUS_GAIN) {
                    hasFocus = true;
                    if (player != null) player.setVolume(1, 1);
                    if (resumeOnFocusGain) {
                        resumeOnFocusGain = false;
                        play();
                    }
                } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    if (player != null) player.setVolume(.2f, .2f);
                } else {
                    boolean resume = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT && playRequested;
                    pause(change == AudioManager.AUDIOFOCUS_LOSS);
                    hasFocus = false;
                    resumeOnFocusGain = resume;
                }
            }, handler).build();
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(
            CHANNEL, "음악 재생", NotificationManager.IMPORTANCE_LOW));
        mediaSession = new MediaSession(this, "SangkiMusic");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { play(); }
            @Override public void onPause() { pause(); }
            @Override public void onSkipToNext() { advance(1, false); }
            @Override public void onSkipToPrevious() { advance(-1, false); }
            @Override public void onSeekTo(long position) { seek(position); }
            @Override public void onStop() { stop(); }
        }, handler);
        mediaSession.setActive(true);
        startForeground(NOTIFICATION_ID, notification());
        foreground = true;
        handler.post(tick);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        try {
            String action = intent.getAction();
            if (!validAction(action)) throw new IllegalArgumentException("지원하지 않는 재생 요청입니다.");
            JSONObject payload = new JSONObject(intent.getStringExtra("payload") == null
                ? "{}" : intent.getStringExtra("payload"));
            switch (action) {
                case "queue":
                    JSONArray incoming = payload.getJSONArray("queue");
                    if (incoming.length() == 0 || incoming.length() > 10000) {
                        throw new IllegalArgumentException("재생할 음악을 선택하세요.");
                    }
                    int requestedIndex = payload.getInt("index");
                    if (requestedIndex < 0 || requestedIndex >= incoming.length()) {
                        throw new IllegalArgumentException("잘못된 음악 순서입니다.");
                    }
                    for (int i = 0; i < incoming.length(); i++) {
                        JSONObject track = incoming.getJSONObject(i);
                        Uri uri = Uri.parse(track.getString("url"));
                        if (!"https".equals(uri.getScheme())
                            || !"ejrwrwjsgizzxhqybtff.supabase.co".equals(uri.getHost())
                            || (uri.getPort() != -1 && uri.getPort() != 443)
                            || !uri.getPath().startsWith("/storage/v1/object/public/music-audio/")) {
                            throw new IllegalArgumentException("허용되지 않은 음악 주소입니다.");
                        }
                        track.getString("id");
                        track.getString("name");
                    }
                    queue = incoming;
                    queueName = payload.optString("name", "음악");
                    setRepeat(payload.optString("repeat", "off"));
                    load(requestedIndex);
                    break;
                case "play": play(); break;
                case "pause": pause(); break;
                case "next": advance(1, false); break;
                case "previous": advance(-1, false); break;
                case "repeat": setRepeat(payload.getString("repeat")); break;
                case "seek": seek(payload.getLong("position")); break;
                case "stop": stop(); break;
                default: throw new IllegalArgumentException("잘못된 재생 요청입니다.");
            }
        } catch (Exception failure) {
            fail(failure);
        }
        publish();
        return START_NOT_STICKY;
    }

    private void setRepeat(String value) {
        if (!"off".equals(value) && !"one".equals(value) && !"all".equals(value)) {
            throw new IllegalArgumentException("잘못된 반복 설정입니다.");
        }
        repeat = value;
    }

    private void load(int nextIndex) {
        releasePlayer();
        index = nextIndex;
        error = "";
        playRequested = true;
        player = new MediaPlayer();
        player.setAudioAttributes(attributes);
        player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
        player.setOnPreparedListener(current -> {
            if (current != player) return;
            prepared = true;
            if (playRequested) play();
            publish();
        });
        player.setOnCompletionListener(current -> {
            if (current == player) advance(1, true);
        });
        player.setOnErrorListener((current, what, extra) -> {
            if (current != player) return true;
            fail(new IllegalStateException("음악 재생 오류 (" + what + "/" + extra
                + "). 연결과 파일 형식을 확인하고 다음 곡으로 이동하세요."));
            return true;
        });
        try {
            JSONObject track = queue.getJSONObject(index);
            player.setDataSource(this, Uri.parse(track.getString("url")));
            player.prepareAsync();
            mediaSession.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, track.getString("name"))
                .putString(MediaMetadata.METADATA_KEY_ARTIST, track.optString("uploaded_by"))
                .putString(MediaMetadata.METADATA_KEY_ALBUM, queueName).build());
        } catch (Exception failure) {
            fail(failure);
        }
        publish();
    }

    private void play() {
        if (player == null) return;
        playRequested = true;
        error = "";
        if (!prepared) return;
        if (!foreground) {
            startForeground(NOTIFICATION_ID, notification());
            foreground = true;
        }
        if (!hasFocus) {
            hasFocus = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            if (!hasFocus) {
                playRequested = false;
                error = "다른 앱이 오디오를 사용 중입니다. 잠시 후 다시 재생하세요.";
                publish();
                return;
            }
        }
        player.start();
        if (!receiverRegistered) {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, filter, RECEIVER_NOT_EXPORTED);
            else registerReceiver(noisy, filter);
            receiverRegistered = true;
        }
        publish();
    }

    private void pause() {
        pause(true);
    }

    private void pause(boolean abandonFocus) {
        playRequested = false;
        resumeOnFocusGain = false;
        if (prepared && player != null && player.isPlaying()) player.pause();
        if (receiverRegistered) {
            unregisterReceiver(noisy);
            receiverRegistered = false;
        }
        if (abandonFocus) audioManager.abandonAudioFocusRequest(focusRequest);
        hasFocus = false;
        publish();
    }

    private void seek(long position) {
        if (!prepared || player == null) return;
        player.seekTo(Math.max(0, Math.min(position, player.getDuration())), MediaPlayer.SEEK_CLOSEST);
        publish();
    }

    private void advance(int direction, boolean ended) {
        if (index < 0 || player == null) return;
        if (ended && "one".equals(repeat)) {
            player.seekTo(0);
            play();
            return;
        }
        int next = index + direction;
        if (next < 0 || next >= queue.length()) {
            if ("all".equals(repeat)) next = (next + queue.length()) % queue.length();
            else {
                if (ended) pause();
                return;
            }
        }
        load(next);
    }

    private void fail(Exception failure) {
        Log.e("SangkiMusic", "Playback failed", failure);
        error = failure.getMessage() == null ? "음악 재생에 실패했습니다." : failure.getMessage();
        releasePlayer();
        pause();
        publish();
    }

    private void releasePlayer() {
        prepared = false;
        if (player != null) {
            player.release();
            player = null;
        }
    }

    private PendingIntent actionIntent(String action) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getForegroundService(this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification notification() {
        boolean playing = prepared && player != null && player.isPlaying();
        String title = "음악을 선택하세요.";
        if (index >= 0 && index < queue.length()) title = queue.optJSONObject(index).optString("name");
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_music)
            .setContentTitle(title)
            .setContentText(error.isEmpty() ? queueName : error)
            .setContentIntent(open)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_media_previous, "이전", actionIntent("previous")).build())
            .addAction(new Notification.Action.Builder(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "일시정지" : "재생", actionIntent(playing ? "pause" : "play")).build())
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_media_next, "다음", actionIntent("next")).build())
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "종료", actionIntent("stop")).build())
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken()).setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    private void publish() {
        try {
            boolean playing = prepared && player != null && player.isPlaying();
            long position = prepared && player != null ? player.getCurrentPosition() : 0;
            long duration = prepared && player != null ? player.getDuration() : 0;
            state = new JSONObject().put("queue", queue).put("index", index)
                .put("name", queueName).put("repeat", repeat).put("playing", playing)
                .put("position", position).put("duration", duration).put("error", error).toString();
            long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP;
            mediaSession.setPlaybackState(new PlaybackState.Builder().setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                    position, playing ? 1f : 0f).build());
            if (duration > 0 && index >= 0) {
                JSONObject track = queue.getJSONObject(index);
                mediaSession.setMetadata(new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, track.getString("name"))
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, track.optString("uploaded_by"))
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, queueName)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, duration).build());
            }
            if (foreground) {
                ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                    .notify(NOTIFICATION_ID, notification());
            }
        } catch (Exception failure) {
            Log.e("SangkiMusic", "Cannot publish player state", failure);
            state = "{\"queue\":[],\"index\":-1,\"playing\":false,\"error\":\"재생 상태를 읽지 못했습니다.\"}";
        }
    }

    private void stop() {
        pause();
        releasePlayer();
        queue = new JSONArray();
        index = -1;
        queueName = "";
        error = "";
        publish();
        foreground = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        handler.removeCallbacks(tick);
        pause();
        releasePlayer();
        queue = new JSONArray();
        index = -1;
        publish();
        mediaSession.release();
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
